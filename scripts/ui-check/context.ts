import type { Page } from '@playwright/test';
import { createFixtures } from './fixtures';
import { createSnapshot } from './snapshot';

export function collectBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // The hostile visual below is meant to be blocked; everything else must load cleanly.
  let expectBlocked = false;
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text()) && !expectBlocked)
      errors.push(message.text());
  });
  return {
    errors,
    get expectBlocked() {
      return expectBlocked;
    },
    set expectBlocked(value: boolean) {
      expectBlocked = value;
    },
  };
}

export async function preparePage(page: Page): Promise<void> {
  await page.goto('http://127.0.0.1:4173');
  await page.getByRole('button', { name: /^Model: Codex/ }).waitFor();
  await page.addInitScript({
    content: `
    window.sent = [];
    window.acquireVsCodeApi = () => ({
      getState: () => undefined, setState: state => state, // as VS Code returns it
      postMessage: message => window.sent.push(message)
    });
  `,
  });
  await page.reload();
  await page.waitForFunction(() =>
    (window as any).sent?.some((message: any) => message.type === 'ready'),
  );
}

export function createContext(page: Page, browserErrors: ReturnType<typeof collectBrowserErrors>) {
  const sentOf = (type: string) =>
    page.evaluate(
      (kind) => (window as any).sent.filter((message: any) => message.type === kind),
      type,
    );
  const { catalog, patch, agents } = createFixtures();
  const snapshot = createSnapshot({ catalog, patch, agents });
  async function update(selectedId?: string) {
    await page.evaluate(
      ({ snapshot, selectedId }) =>
        window.postMessage(
          { type: 'snapshot', snapshot, selectedId, imageBase: '/fixture-images' },
          '*',
        ),
      { snapshot, selectedId },
    );
    const expected = snapshot.sessions.find((session) => session.id === selectedId)?.title;
    if (!expected) return;
    await page.waitForFunction(
      (title) => document.querySelector('.session-name')?.textContent?.trim() === title,
      expected,
    );
  }
  const box = page.locator('textarea[aria-label="Message your agent"]');
  const thinkingToggle = page.getByRole('button', { name: 'Thinking', exact: true });
  const nav = page.getByRole('navigation', { name: 'Agent sessions' });
  const threads = page.getByRole('navigation', { name: 'Agent sessions' });
  const tablist = page.getByRole('tablist', { name: 'Open threads' });
  const pickAgent = async (agent: string, option: string) => {
    await page.getByRole('button', { name: /^Model:/ }).click();
    await page
      .getByRole('tablist', { name: 'Agents' })
      .getByRole('tab', { name: agent, exact: true })
      .click();
    await page.getByRole('option', { name: option }).click();
  };
  const pressed = async (value: 'true' | 'false') =>
    page.waitForFunction(
      (want) =>
        document.querySelector('button[aria-label="Thinking"]')?.getAttribute('aria-pressed') ===
        want,
      value,
    );
  const canvasWith = (appearance: string, className: string) =>
    page.evaluate(
      ({ appearance, className }) => {
        document.documentElement.dataset.appearance = appearance;
        document.body.className = className;
        document.body.style.setProperty('--vscode-editor-background', '#444444');
        return getComputedStyle(document.body).getPropertyValue('--canvas').trim();
      },
      { appearance, className },
    );
  const luminance = (rgb: string) => {
    const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
      const channel = Number(value) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const quiet = async () =>
    (await sentOf('start')).length +
    (await sentOf('send')).length +
    (await sentOf('delegate')).length;
  const tabNamed = (name: RegExp | string) => tablist.getByRole('tab', { name });
  const draftTabs = () => tablist.getByRole('tab', { name: /New chat|unsent words/ }).count();
  return {
    page,
    errors: browserErrors.errors,
    browserErrors,
    catalog,
    patch,
    snapshot,
    box,
    thinkingToggle,
    nav,
    tablist,
    threads,
    sentOf,
    update,
    pickAgent,
    pressed,
    canvasWith,
    luminance,
    quiet,
    tabNamed,
    draftTabs,
  };
}

export type UiCheckContext = ReturnType<typeof createContext>;
