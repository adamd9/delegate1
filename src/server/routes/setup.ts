import type { Application, Request, Response } from 'express';
import { fetch } from 'undici';
import { configService } from '../../config';

type ValidationResult = boolean | null;
type GroupStatus = 'complete' | 'partial' | 'unconfigured';

interface SetupItemDefinition {
  key: string;
  label: string;
}

interface SetupGroupDefinition {
  id: string;
  name: string;
  description: string;
  required: boolean;
  items: SetupItemDefinition[];
}

interface ValidationCacheEntry {
  expiresAt: number;
  value: boolean;
}

const VALIDATION_TTL_MS = 60_000;
const VALIDATION_TIMEOUT_MS = 5_000;

const validationCache = new Map<string, ValidationCacheEntry>();

const SETUP_GROUPS: SetupGroupDefinition[] = [
  {
    id: 'core',
    name: 'Core',
    description: 'Essential AI and runtime settings',
    required: true,
    items: [
      { key: 'OPENAI_API_KEY', label: 'OpenAI API Key' },
      { key: 'PUBLIC_URL', label: 'Public URL' },
      { key: 'TIMEZONE', label: 'Timezone' },
    ],
  },
  {
    id: 'twilio-calls',
    name: 'Twilio - Calls',
    description: 'Voice calling and Twilio client credentials',
    required: false,
    items: [
      { key: 'TWILIO_ACCOUNT_SID', label: 'Twilio Account SID' },
      { key: 'TWILIO_AUTH_TOKEN', label: 'Twilio Auth Token' },
      { key: 'TWILIO_API_KEY_SID', label: 'Twilio API Key SID' },
      { key: 'TWILIO_API_KEY_SECRET', label: 'Twilio API Key Secret' },
      { key: 'TWILIO_TWIML_APP_SID', label: 'Twilio TwiML App SID' },
    ],
  },
  {
    id: 'twilio-sms',
    name: 'Twilio - SMS',
    description: 'SMS delivery credentials and defaults',
    required: false,
    items: [
      { key: 'TWILIO_SMS_ACCOUNT_SID', label: 'Twilio SMS Account SID' },
      { key: 'TWILIO_SMS_AUTH_TOKEN', label: 'Twilio SMS Auth Token' },
      { key: 'TWILIO_MESSAGING_SERVICE_SID', label: 'Twilio Messaging Service SID' },
      { key: 'TWILIO_SMS_DEFAULT_TO', label: 'Twilio SMS Default To' },
    ],
  },
  {
    id: 'email-sending',
    name: 'Email - Sending',
    description: 'SMTP settings for outbound email',
    required: false,
    items: [
      { key: 'EMAIL_SMTP_HOST', label: 'SMTP Host' },
      { key: 'EMAIL_SMTP_PORT', label: 'SMTP Port' },
      { key: 'EMAIL_SMTP_USER', label: 'SMTP User' },
      { key: 'EMAIL_SMTP_PASS', label: 'SMTP Password' },
      { key: 'EMAIL_DEFAULT_FROM', label: 'Default From Address' },
    ],
  },
  {
    id: 'email-receiving',
    name: 'Email - Receiving',
    description: 'IMAP settings for inbound email',
    required: false,
    items: [
      { key: 'EMAIL_IMAP_HOST', label: 'IMAP Host' },
      { key: 'EMAIL_IMAP_PORT', label: 'IMAP Port' },
      { key: 'EMAIL_IMAP_USER', label: 'IMAP User' },
      { key: 'EMAIL_IMAP_PASSWORD', label: 'IMAP Password' },
    ],
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent memory backend configuration',
    required: false,
    items: [
      { key: 'MEM0_API_KEY', label: 'Mem0 API Key' },
      { key: 'MEM0_API_HOST', label: 'Mem0 API Host' },
    ],
  },
  {
    id: 'voice',
    name: 'Voice',
    description: 'Speech-to-text and voice tuning settings',
    required: false,
    items: [
      { key: 'DEEPGRAM_API_KEY', label: 'Deepgram API Key' },
      { key: 'DELEGATE_TTS_MODEL', label: 'TTS Model' },
      { key: 'DELEGATE_CHAT_VOICE_SPEED', label: 'Chat Voice Speed' },
    ],
  },
  {
    id: 'browser-copilot',
    name: 'Browser / Copilot',
    description: 'Browser automation and Copilot integration settings',
    required: false,
    items: [
      { key: 'BROWSER_ENABLED', label: 'Browser Enabled' },
      { key: 'COPILOT_GITHUB_TOKEN', label: 'Copilot GitHub Token' },
      { key: 'COPILOT_REMOTE_REPO', label: 'Copilot Remote Repo' },
      { key: 'VNC_PASSWORD', label: 'VNC Password' },
    ],
  },
];

function getConfigValue(key: string): string {
  return (configService.get(key) || '').trim();
}

function isConfigured(key: string): boolean {
  return getConfigValue(key).length > 0;
}

function getGroupStatus(configuredCount: number, totalItems: number): GroupStatus {
  if (configuredCount === 0) return 'unconfigured';
  if (configuredCount === totalItems) return 'complete';
  return 'partial';
}

async function getCachedValidation(cacheKey: string, validate: () => Promise<boolean>): Promise<boolean> {
  const cached = validationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = await validate().catch(() => false);
  validationCache.set(cacheKey, { value, expiresAt: Date.now() + VALIDATION_TTL_MS });
  return value;
}

async function validateTwilioCalls(): Promise<ValidationResult> {
  const accountSid = getConfigValue('TWILIO_ACCOUNT_SID');
  const authToken = getConfigValue('TWILIO_AUTH_TOKEN');
  if (!accountSid || !authToken) {
    return null;
  }

  return getCachedValidation(`twilio-calls:${accountSid}:${authToken}`, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);

    try {
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        },
        signal: controller.signal,
      });
      await response.text().catch(() => '');
      return response.status === 200;
    } finally {
      clearTimeout(timeout);
    }
  });
}

async function collectValidationResults(): Promise<Record<string, ValidationResult>> {
  const openAiKey = getConfigValue('OPENAI_API_KEY');
  const [twilioCallsValidated] = await Promise.all([
    validateTwilioCalls(),
  ]);

  return {
    OPENAI_API_KEY: openAiKey ? openAiKey.startsWith('sk-') : null,
    TWILIO_ACCOUNT_SID: twilioCallsValidated,
    TWILIO_AUTH_TOKEN: twilioCallsValidated,
    EMAIL_SMTP_HOST: null,
    EMAIL_SMTP_PORT: null,
    EMAIL_SMTP_USER: null,
    EMAIL_SMTP_PASS: null,
  };
}

export function registerSetupRoutes(app: Application) {
  app.get('/api/setup/status', async (_req: Request, res: Response) => {
    try {
      const validations = await collectValidationResults();

      const groups = SETUP_GROUPS.map((group) => {
        const items = group.items.map((item) => ({
          key: item.key,
          label: item.label,
          configured: isConfigured(item.key),
          validated: validations[item.key] ?? null,
        }));
        const configuredCount = items.filter((item) => item.configured).length;

        return {
          id: group.id,
          name: group.name,
          description: group.description,
          required: group.required,
          status: getGroupStatus(configuredCount, items.length),
          items,
        };
      });

      const requiredGroups = groups.filter((group) => group.required);
      const totalRequiredItems = requiredGroups.reduce((sum, group) => sum + group.items.length, 0);
      const configuredRequiredItems = requiredGroups.reduce(
        (sum, group) => sum + group.items.filter((item) => item.configured).length,
        0,
      );
      const progress = totalRequiredItems === 0
        ? 100
        : Math.round((configuredRequiredItems / totalRequiredItems) * 100);

      res.json({ progress, groups });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to load setup status' });
    }
  });
}
