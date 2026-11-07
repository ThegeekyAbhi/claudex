import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import type { Session } from '../src/shared/model';
import { collectBrowserErrors, createContext, preparePage } from './ui-check/context';
import { checkAppearance } from './ui-check/sections/appearance';
import { checkAttachments } from './ui-check/sections/attachments';
import { checkChanges } from './ui-check/sections/changes';
import { checkChildThreads } from './ui-check/sections/child-threads';
import { checkContextMenu } from './ui-check/sections/context-menu';
import { checkContinueAgent } from './ui-check/sections/continue-agent';
import { checkConversation } from './ui-check/sections/conversation';
import { checkImages } from './ui-check/sections/images';
import { checkLayout } from './ui-check/sections/layout';
import { checkMarkdown } from './ui-check/sections/markdown';
import { checkMascot } from './ui-check/sections/mascot';
import { checkModeGuides } from './ui-check/sections/mode-guides';
import { checkModels } from './ui-check/sections/models';
import { checkNewChatModes } from './ui-check/sections/new-chat-modes';
import { checkOnboarding } from './ui-check/sections/onboarding';
import { checkOverview } from './ui-check/sections/overview';
import { checkPlan } from './ui-check/sections/plan';
import { checkProfiles } from './ui-check/sections/profiles';
import { checkQuestions } from './ui-check/sections/questions';
import { checkSkills } from './ui-check/sections/skills';
import { checkTabs } from './ui-check/sections/tabs';
import { checkTerminalDrafts } from './ui-check/sections/terminal-drafts';
import { checkThinking } from './ui-check/sections/thinking';
import { checkThreadFilters } from './ui-check/sections/thread-filters';
import { checkUsage } from './ui-check/sections/usage';
import { checkVisuals } from './ui-check/sections/visuals';
import { checkWorktree } from './ui-check/sections/worktree';

export type { Session };

const preview = spawn(process.execPath, ['scripts/preview.mjs'], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise<void>((resolve, reject) => {
  preview.stdout.once('data', () => resolve());
  preview.once('error', reject);
  preview.once('exit', (code) => reject(new Error(`Preview exited: ${code}`)));
});
const cached = path.join(
  homedir(),
  'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);
const browser = await chromium.launch({
  headless: true,
  executablePath: existsSync(cached) ? cached : undefined,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'reduce',
});
const browserErrors = collectBrowserErrors(page);
const { errors } = browserErrors;
await mkdir('test-results/screenshots', { recursive: true });
try {
  await preparePage(page);
  const ctx = createContext(page, browserErrors);
  // These sections intentionally share one page and must run in this order.
  const sections = [
    checkModels,
    checkWorktree,
    checkThinking,
    checkConversation,
    checkQuestions,
    checkUsage,
    checkChildThreads,
    checkTerminalDrafts,
    checkChanges,
    checkNewChatModes,
    checkSkills,
    checkPlan,
    checkMarkdown,
    checkImages,
    checkContextMenu,
    checkAttachments,
    checkMascot,
    checkLayout,
    checkAppearance,
    checkModeGuides,
    checkThreadFilters,
    checkTabs,
    checkVisuals,
    checkContinueAgent,
    checkProfiles,
    checkOverview,
    checkOnboarding,
  ];
  for (const section of sections) await section(ctx);
  console.log(
    'UI checks passed: no-prompt start, model and effort menus, appearance, mode colours, guide toggles, sandboxed visuals, thread filters, thread tabs and signals, modes, plan card, Markdown and highlighting, images, the @ and # menu, attachments, worktree opt-in, thinking, diffs, questions, usage, child threads, approvals, drafts, continuing in another agent, agent profiles, changes panel, first-run setup, side bar widths, and 4 viewport sizes.',
  );
} catch (error) {
  await page.screenshot({ path: 'test-results/screenshots/failure.png' });
  console.error('Browser errors:', errors);
  throw error;
} finally {
  await browser.close();
  preview.kill();
}
