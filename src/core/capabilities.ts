import type { AgentMode, Provider } from './agents';

/**
 * What each CLI supports, as data, so the UI asks what is possible rather than which provider
 * it is talking to. Lives in core because the webview reads it. Each adapter owns the mapping
 * from a mode to its CLI's real settings.
 */
export interface ProviderCapabilities {
  modes: Record<AgentMode, string>;
  /** The CLI has an API for turning a skill on or off. */
  skillToggle: boolean;
}

export const CAPABILITIES: Record<Provider, ProviderCapabilities> = {
  claude: {
    modes: {
      ask: 'Reads and answers. Edit tools are off, though commands your Claude settings allow can still run',
      plan: 'Researches and writes a plan before changing anything',
      agent: 'Reads, edits, and runs commands, asking when Claude requires',
      auto: 'Works on its own. Claude’s classifier decides each request and asks you when unsure',
    },
    skillToggle: false,
  },
  codex: {
    modes: {
      ask: 'Reads and answers in a read-only sandbox with no network',
      plan: 'Researches and writes a plan before changing anything',
      agent: 'Works with this thread’s sandbox and approval settings',
      auto: 'Works in the same sandbox, with a Codex reviewer handling approval requests',
    },
    skillToggle: true,
  },
};
