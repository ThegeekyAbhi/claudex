import type { ModelOption, Session } from './session';

export type Thinking = 'default' | 'on' | 'off';
export const THINKING_LABELS: Record<Thinking, string> = {
  default: 'Default',
  on: 'On',
  off: 'Off',
};

/**
 * What one click on the toggle chooses. Every result is one this model supports, or Default,
 * so the button can't send a choice the host would refuse.
 */
export function nextThinking(current: Thinking, support: { on: boolean; off: boolean }): Thinking {
  if (current === 'on') return support.off ? 'off' : 'default';
  if (current === 'off') return support.on ? 'on' : 'default';
  if (support.on) return 'on';
  return support.off ? 'off' : 'default';
}
export function thinkingSupport(provider: Session['provider'], model?: ModelOption) {
  if (!model) return { on: false, off: false, reason: 'Availability unknown' };
  if (provider === 'codex') {
    const on = model.efforts.some((effort) => effort !== 'none');
    const off = model.efforts.includes('none');
    return { on, off, reason: off ? '' : 'Thinking cannot be disabled for this model' };
  }
  const id = model.resolvedModel ?? model.id;
  // Adaptive support alone does not establish whether a model accepts disabled thinking.
  const off = /^claude-(?:opus-4-[678]|sonnet-(?:4-6|5))(?:-\d{8})?$/.test(id);
  return {
    on: model.adaptiveThinking === true,
    off,
    reason: off ? '' : 'Disabling thinking is not verified for this model',
  };
}

export function effectiveEffort(session: Pick<Session, 'thinking' | 'effort'>): string | undefined {
  return session.thinking === 'off' ? 'none' : session.effort;
}
