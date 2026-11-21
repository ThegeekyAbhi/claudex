import { useState } from 'react';
import type { PageViewState } from '../../../../shared/protocol/pages';
import { post } from '../shared/page-bridge';

/**
 * Asking an agent about the page: the message you're writing, which agent and mode answer, and
 * the nudge that opens the page's chat when something else asks.
 */
export function usePageAsk(state: PageViewState | undefined, flush: () => void) {
  const [prompt, setPrompt] = useState('');
  const [profile, setProfile] = useState<string>();
  const [mode, setMode] = useState<'ask' | 'auto'>('auto');
  /** Bumped to open the chat, so you see the agent take up what you just asked. */
  const [reveal, setReveal] = useState(0);
  const chosen = profile ?? state?.defaultProfile ?? state?.agents[0]?.id;

  const ask = (message = prompt) => {
    const clean = message.trim();
    if (!clean || !state?.trusted) return;
    flush();
    post({ type: 'pageAsk', prompt: clean, ...(chosen ? { profile: chosen } : {}), mode });
    setPrompt('');
  };
  /** Asks about the selected text right away; the reply opens in the page's chat. */
  const askAbout = (instruction: string, selected: string) => {
    const quoted = selected
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    ask(`${instruction.trim()}\n\n${quoted}\n\nSuggest the change as an edit to the page.`);
    setReveal((value) => value + 1);
  };
  return { prompt, setPrompt, chosen, setProfile, mode, setMode, reveal, ask, askAbout };
}
