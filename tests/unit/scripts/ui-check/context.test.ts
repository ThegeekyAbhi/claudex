import { deepEqual, equal, notEqual, ok } from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Page } from '@playwright/test';
import {
  collectBrowserErrors,
  createContext,
  preparePage,
} from '../../../../scripts/ui-check/context';

test('browser errors use the live CSP flag and always retain page errors', () => {
  const events = new EventEmitter();
  const state = collectBrowserErrors(events as unknown as Page);
  const consoleMessage = (text: string) => events.emit('console', { text: () => text });
  consoleMessage('ordinary console output');
  consoleMessage('Content Security Policy: unexpected');
  state.expectBlocked = true;
  consoleMessage('Content Security Policy: expected');
  events.emit('pageerror', new Error('page failure during visual'));
  state.expectBlocked = false;
  consoleMessage('Content Security Policy: unexpected after visual');
  deepEqual(state.errors, [
    'Content Security Policy: unexpected',
    'page failure during visual',
    'Content Security Policy: unexpected after visual',
  ]);
});

function mockPage() {
  const evaluations: unknown[] = [];
  const titles: unknown[] = [];
  const page = {
    locator: () => ({}),
    getByRole: () => ({}),
    evaluate: async (_callback: unknown, argument: unknown) => {
      evaluations.push(argument);
      return typeof argument === 'string' ? [] : undefined;
    },
    waitForFunction: async (_callback: unknown, title: unknown) => {
      titles.push(title);
    },
  } as unknown as Page;
  return { page, evaluations, titles };
}

test('snapshot updates send shared mutations and wait only for a known selected title', async () => {
  const { page, evaluations, titles } = mockPage();
  const browserErrors = { errors: [] as string[], expectBlocked: false };
  const ctx = createContext(page, browserErrors);
  ctx.snapshot.sessions[0].title = 'Changed title';
  await ctx.update('codex-one');
  await ctx.update(undefined);
  await ctx.update('missing');
  deepEqual(titles, ['Changed title']);
  deepEqual(evaluations, [
    { snapshot: ctx.snapshot, selectedId: 'codex-one' },
    { snapshot: ctx.snapshot, selectedId: undefined },
    { snapshot: ctx.snapshot, selectedId: 'missing' },
  ]);
  equal(ctx.snapshot.catalog, ctx.catalog);
  equal(ctx.errors, browserErrors.errors);
  browserErrors.expectBlocked = true;
  equal(ctx.browserErrors.expectBlocked, true);
});

test('contexts keep separate fixtures and filter outbound messages by their original type', async () => {
  const first = mockPage();
  const second = mockPage();
  const a = createContext(first.page, { errors: [], expectBlocked: false });
  const b = createContext(second.page, { errors: [], expectBlocked: false });
  notEqual(a.snapshot, b.snapshot);
  notEqual(a.catalog, b.catalog);
  notEqual(a.snapshot.agents, b.snapshot.agents);
  a.catalog.codex.models[0].efforts.push('test-only');
  ok(!b.catalog.codex.models[0].efforts.includes('test-only'));
  await a.sentOf('approve');
  deepEqual(first.evaluations, ['approve']);
  deepEqual(second.evaluations, []);
});

test('page preparation preserves navigation, bridge installation, reload and ready order', async () => {
  const calls: unknown[] = [];
  const page = {
    goto: async (url: string) => calls.push(url),
    getByRole: (role: string, options: unknown) => ({
      waitFor: async () => calls.push({ role, options }),
    }),
    addInitScript: async ({ content }: { content: string }) => {
      ok(content.includes('postMessage: message => window.sent.push(message)'));
      calls.push('bridge');
    },
    reload: async () => calls.push('reload'),
    waitForFunction: async () => calls.push('ready'),
  } as unknown as Page;
  await preparePage(page);
  deepEqual(calls, [
    'http://127.0.0.1:4173',
    { role: 'button', options: { name: /^Model: Codex/ } },
    'bridge',
    'reload',
    'ready',
  ]);
});
