"use client";

import React from 'react';
import { fetchMcpConfig, updateMcpConfig, McpServerConfig } from '@/lib/mcp-config-client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export default function McpServersPage() {
  const [text, setText] = React.useState('');
  const [servers, setServers] = React.useState<McpServerConfig[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [originalText, setOriginalText] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const data = await fetchMcpConfig();
      setText(data.text);
      setOriginalText(data.text);
      setServers(data.servers);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const dirty = text !== originalText;

  const onSave = async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const result = await updateMcpConfig(text);
      setServers(result.servers);
      setOriginalText(text);
      setStatus('Configuration saved and MCP discovery reloaded.');
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Remote MCP Servers</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-xl">
            Edit the JSON array of remote MCP servers. Changes are written to runtime data and applied immediately after saving.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading || saving}>
            Refresh
          </Button>
          <Button onClick={() => void onSave()} disabled={saving || loading || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 rounded border border-red-100">{error}</div>}
      {status && <div className="p-3 bg-green-50 text-green-700 rounded border border-green-100">{status}</div>}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-gray-600 uppercase tracking-wide">Configured servers</h2>
          <div className="space-y-2">
            {servers.length === 0 && (
              <div className="text-sm text-gray-500 border rounded p-3">No MCP servers configured.</div>
            )}
            {servers.map((server) => (
              <div key={`${server.name}-${server.url}`} className="border rounded p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{server.name}</div>
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{server.type}</span>
                </div>
                <div className="text-sm text-gray-600 break-all">{server.url}</div>
                {server.description && <div className="text-xs text-gray-500">{server.description}</div>}
                {server.note && <div className="text-xs text-gray-400">{server.note}</div>}
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700" htmlFor="mcp-config-text">Configuration JSON</label>
          <Textarea
            id="mcp-config-text"
            className="font-mono text-sm h-[28rem]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={loading || saving}
            spellCheck={false}
          />
          <p className="text-xs text-gray-500">
            The configuration is stored under <code>websocket-server/runtime-data/mcp-servers.json</code> and is excluded from source control.
          </p>
        </div>
      </div>
    </div>
  );
}
