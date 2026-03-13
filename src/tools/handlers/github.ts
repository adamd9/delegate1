import { FunctionHandler } from '../../agentConfigs/types';

const GITHUB_API = 'https://api.github.com';

function getHeaders(): { headers: Record<string, string>; error?: undefined } | { error: string } {
  const pat = process.env.GITHUB_PAT;
  if (!pat) {
    return { error: 'GITHUB_PAT not configured. Set the GITHUB_PAT environment variable to a GitHub Personal Access Token.' };
  }
  return {
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Delegate1-Assistant',
    },
  };
}

async function handleResponse(res: Response, context: string): Promise<{ error: string } | any> {
  if (res.status === 401) {
    return { error: `GitHub authentication failed (401). Check that GITHUB_PAT is valid and has the required scopes.` };
  }
  if (res.status === 403) {
    const remaining = res.headers.get('X-RateLimit-Remaining');
    if (remaining === '0') {
      const reset = res.headers.get('X-RateLimit-Reset');
      const resetDate = reset ? new Date(Number(reset) * 1000).toISOString() : 'unknown';
      return { error: `GitHub API rate limit exceeded. Resets at ${resetDate}.` };
    }
    return { error: `GitHub API forbidden (403) for ${context}. Check PAT permissions.` };
  }
  if (res.status === 404) {
    return { error: `Not found (404): ${context}. Check that the repository exists and the PAT has access.` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { error: `GitHub API error ${res.status} for ${context}: ${body}` };
  }
  return res.json();
}

// ─── list_github_repos ───────────────────────────────────────────────

export const listGithubReposFunction: FunctionHandler = {
  schema: {
    name: 'list_github_repos',
    type: 'function',
    description:
      'List GitHub repositories accessible to the authenticated user. Can optionally filter by organization, type, and sort order.',
    parameters: {
      type: 'object',
      properties: {
        org: {
          type: 'string',
          description: 'Filter repositories by organization name. If omitted, lists the authenticated user\'s repos.',
        },
        type: {
          type: 'string',
          enum: ['all', 'owner', 'member'],
          description: 'Filter repo type. Defaults to "all".',
        },
        sort: {
          type: 'string',
          enum: ['created', 'updated', 'pushed', 'full_name'],
          description: 'Sort order for results. Defaults to "updated".',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  handler: async ({ org, type = 'all', sort = 'updated' }: { org?: string; type?: string; sort?: string }) => {
    console.debug('[listGithubRepos] Invoked', { org, type, sort });
    const auth = getHeaders();
    if ('error' in auth) return { error: auth.error };

    const url = org
      ? `${GITHUB_API}/orgs/${encodeURIComponent(org)}/repos?sort=${sort}&per_page=100`
      : `${GITHUB_API}/user/repos?type=${type}&sort=${sort}&per_page=100`;

    try {
      const res = await fetch(url, { headers: auth.headers });
      const data = await handleResponse(res, org ? `org "${org}" repos` : 'user repos');
      if (data.error) return data;

      return (data as any[]).map((r: any) => ({
        name: r.name,
        full_name: r.full_name,
        description: r.description,
        html_url: r.html_url,
        private: r.private,
        default_branch: r.default_branch,
      }));
    } catch (e: any) {
      return { error: e?.message || String(e) };
    }
  },
};

// ─── create_github_issue ─────────────────────────────────────────────

export const createGithubIssueFunction: FunctionHandler = {
  schema: {
    name: 'create_github_issue',
    type: 'function',
    description:
      'Create a new issue on a GitHub repository. Returns the issue number, URL, title, and state.',
    parameters: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Full repository name in "owner/repo" format.',
        },
        title: {
          type: 'string',
          description: 'Issue title.',
        },
        body: {
          type: 'string',
          description: 'Issue body/description (supports Markdown).',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Labels to apply to the issue.',
        },
        assignees: {
          type: 'array',
          items: { type: 'string' },
          description: 'GitHub usernames to assign to the issue.',
        },
      },
      required: ['repo', 'title'],
      additionalProperties: false,
    },
  },
  handler: async ({
    repo,
    title,
    body,
    labels,
    assignees,
  }: {
    repo: string;
    title: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
  }) => {
    console.debug('[createGithubIssue] Invoked', { repo, title });
    const auth = getHeaders();
    if ('error' in auth) return { error: auth.error };

    const url = `${GITHUB_API}/repos/${repo}/issues`;
    const payload: Record<string, any> = { title };
    if (body) payload.body = body;
    if (labels?.length) payload.labels = labels;
    if (assignees?.length) payload.assignees = assignees;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify(payload),
      });
      const data = await handleResponse(res, `create issue on ${repo}`);
      if (data.error) return data;

      return {
        number: data.number,
        html_url: data.html_url,
        title: data.title,
        state: data.state,
      };
    } catch (e: any) {
      return { error: e?.message || String(e) };
    }
  },
};

// ─── start_copilot_agent_session ─────────────────────────────────────

export const startCopilotAgentSessionFunction: FunctionHandler = {
  schema: {
    name: 'start_copilot_agent_session',
    type: 'function',
    description:
      'Create a GitHub issue assigned to the Copilot coding agent (copilot-swe-agent) to start an automated coding session. Automatically adds the "copilot" label.',
    parameters: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Full repository name in "owner/repo" format.',
        },
        title: {
          type: 'string',
          description: 'Task description as the issue title.',
        },
        body: {
          type: 'string',
          description: 'Detailed task description (supports Markdown).',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional labels to apply (the "copilot" label is added automatically).',
        },
      },
      required: ['repo', 'title'],
      additionalProperties: false,
    },
  },
  handler: async ({
    repo,
    title,
    body,
    labels,
  }: {
    repo: string;
    title: string;
    body?: string;
    labels?: string[];
  }) => {
    console.debug('[startCopilotAgentSession] Invoked', { repo, title });
    const auth = getHeaders();
    if ('error' in auth) return { error: auth.error };

    const agentNote = '> 🤖 *This issue was created for the Copilot coding agent. It will automatically begin working on this task.*\n\n';
    const issueBody = body ? `${agentNote}${body}` : agentNote.trimEnd();

    const allLabels = new Set(labels || []);
    allLabels.add('copilot');

    const url = `${GITHUB_API}/repos/${repo}/issues`;
    const payload = {
      title,
      body: issueBody,
      labels: [...allLabels],
      assignees: ['copilot-swe-agent'],
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify(payload),
      });
      const data = await handleResponse(res, `create Copilot agent issue on ${repo}`);
      if (data.error) return data;

      return {
        number: data.number,
        html_url: data.html_url,
        title: data.title,
        state: data.state,
        assignees: (data.assignees as any[])?.map((a: any) => a.login) || ['copilot-swe-agent'],
      };
    } catch (e: any) {
      return { error: e?.message || String(e) };
    }
  },
};
