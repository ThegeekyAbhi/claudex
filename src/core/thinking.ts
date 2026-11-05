import type { ModelOption, Session } from './session';

export type Thinking = 'default' | 'on' | 'off';
export const THINKING_LABELS: Record<Thinking, string> = {
  default: 'Default',
  on: 'On',
  off: 'Off',
};

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
