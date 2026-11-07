import assert from 'node:assert/strict';
import type { UiCheckContext } from '../context';

export async function checkAppearance(ctx: UiCheckContext): Promise<void> {
  // Uses the desktop viewport restored by layout.
  const { page, canvasWith } = ctx;
  for (const [className, background, foreground] of [
    ['vscode-dark', '#181818', '#dedede'],
    ['vscode-dark', '#102030', '#d0e0f0'],
    ['vscode-high-contrast', '#000000', '#ffffff'],
    ['vscode-high-contrast-light', '#ffffff', '#000000'],
  ]) {
    const colors = await page.evaluate(
      ({ className, background, foreground }) => {
        document.documentElement.dataset.appearance = 'editor';
        document.body.className = className;
        document.body.style.setProperty('--vscode-editor-background', background);
        document.body.style.setProperty('--vscode-foreground', foreground);
        const style = getComputedStyle(document.body);
        return { background: style.backgroundColor, foreground: style.color };
      },
      { className, background, foreground },
    );
    assert.notEqual(colors.background, colors.foreground);
    assert.equal(
      await page.evaluate(() =>
        getComputedStyle(document.body).getPropertyValue('--canvas').trim(),
      ),
      background,
    );
  }
  await page.evaluate(() => {
    document.body.className = '';
    document.body.style.removeProperty('--vscode-editor-background');
    document.body.style.removeProperty('--vscode-foreground');
  });
  assert.equal(await canvasWith('cursor', 'vscode-dark'), '#181818', 'any dark theme');
  assert.equal(await canvasWith('editor', 'vscode-dark'), '#444444', 'turned off');
  assert.equal(await canvasWith('cursor', 'vscode-light'), '#444444', 'light keeps the editor');
  assert.equal(await canvasWith('cursor', 'vscode-high-contrast'), '#444444');
  assert.equal(await canvasWith('cursor', 'vscode-high-contrast-light'), '#444444');
  await page.evaluate(() => document.body.style.removeProperty('--vscode-editor-background'));
  await canvasWith('cursor', 'vscode-dark');
  await page.evaluate(() => document.body.style.removeProperty('--vscode-editor-background'));
}
