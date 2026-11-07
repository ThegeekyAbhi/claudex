import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkThinking(ctx: UiCheckContext): Promise<void> {
  // Continues the empty draft left by worktree.
  const { catalog, thinkingToggle, update, pickAgent, pressed } = ctx;
  await pickAgent('Codex', 'GPT-6-Luna');
  catalog.codex.models[1].efforts.unshift('none');
  await update(undefined);
  // Thinking is one click, and stays within what the model supports.
  await pressed('false');
  await thinkingToggle.click();
  await pressed('true');
  await thinkingToggle.click();
  await pressed('false');
  // This model can't turn thinking off, so the toggle goes On, then back to Default.
  catalog.codex.models[1].efforts.shift();
  await update(undefined);
  await thinkingToggle.click();
  await pressed('true');
  await thinkingToggle.click();
  await pressed('false');
  assert.equal(await thinkingToggle.isEnabled(), true);
  catalog.codex.models[1].efforts.unshift('none');
  await update(undefined);
}
