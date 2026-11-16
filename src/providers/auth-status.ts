import type { AgentAuth, Provider } from '../shared/model';
import { type RunResult, runProvider } from './spawn';

const UNKNOWN: AgentAuth = { state: 'unknown' };
const title = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const CLAUDE_METHODS: Record<string, string> = {
  'claude.ai': 'Claude account',
  oauth_token: 'Claude account',
  api_key: 'API key',
  apiKey: 'API key',
};

/** `claude auth status --json`: prints JSON whether or not it is signed in (exit 1 when not). */
export function parseClaudeAuth(result: RunResult): AgentAuth {
  let data: unknown;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    return UNKNOWN;
  }
  if (!data || typeof data !== 'object') return UNKNOWN;
  const { loggedIn, authMethod, subscriptionType } = data as Record<string, unknown>;
  if (loggedIn === false) return { state: 'signedOut' };
  if (loggedIn !== true) return UNKNOWN;
  const method =
    typeof authMethod === 'string' && authMethod !== 'none'
      ? (CLAUDE_METHODS[authMethod] ?? authMethod)
      : undefined;
  const plan =
    typeof subscriptionType === 'string' && /^[\w -]{1,24}$/.test(subscriptionType)
      ? title(subscriptionType)
      : undefined;
  return { state: 'signedIn', ...(method ? { method } : {}), ...(plan ? { plan } : {}) };
}

/** `codex login status`: "Logged in using ChatGPT" (exit 0) or "Not logged in" (exit 1). */
export function parseCodexAuth(result: RunResult): AgentAuth {
  const text = `${result.stdout}\n${result.stderr}`;
  if (result.code === 0) {
    const using = /Logged in using (.+)/i.exec(text)?.[1]?.trim();
    if (!using && !/logged in/i.test(text)) return UNKNOWN;
    const method = using
      ? /api key/i.test(using)
        ? 'API key'
        : using.replace(/^an?\s+/i, '').slice(0, 40)
      : undefined;
    return { state: 'signedIn', ...(method ? { method } : {}) };
  }
  return /not logged in/i.test(text) ? { state: 'signedOut' } : UNKNOWN;
}

/**
 * Asks the CLI whether it is signed in. The CLI reads its own credentials; this only sees its
 * answer. Anything unexpected (old CLI, timeout, odd output) is `unknown`, never signed out.
 */
export async function agentAuthStatus(
  provider: Provider,
  executable: string,
  env?: Record<string, string>,
): Promise<AgentAuth> {
  try {
    const result = await runProvider(
      executable,
      provider === 'claude' ? ['auth', 'status', '--json'] : ['login', 'status'],
      { timeoutMs: 8000, env, maxBytes: 64 * 1024 },
    );
    return provider === 'claude' ? parseClaudeAuth(result) : parseCodexAuth(result);
  } catch {
    return UNKNOWN;
  }
}
