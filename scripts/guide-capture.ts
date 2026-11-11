import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium, type Locator } from '@playwright/test';
import { collectBrowserErrors, createContext, preparePage } from './ui-check/context';

export async function captureGuide(name: string, scenes: (guide: Guide) => Promise<void>) {
  const output = 'media/guide';
  const framesDir = `test-results/${name}-guide`;
  await mkdir(output, { recursive: true });
  await mkdir(framesDir, { recursive: true });
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
  const browser = await chromium
    .launch({ executablePath: existsSync(cached) ? cached : undefined })
    .catch((error) => {
      preview.kill();
      throw error;
    });
  try {
    const page = await browser.newPage({
      viewport: { width: 1000, height: 760 },
      reducedMotion: 'reduce',
    });
    const errors = collectBrowserErrors(page);
    await preparePage(page);
    const ctx = createContext(page, errors);
    ctx.snapshot.project = 'sample-project';
    ctx.snapshot.sessions = [];
    ctx.snapshot.documents = [];
    ctx.snapshot.agents.profiles = [
      {
        id: 'claude',
        label: 'Claude Personal',
        provider: 'claude',
        builtin: true,
        status: 'ready',
      },
      { id: 'codex', label: 'Codex Personal', provider: 'codex', builtin: true, status: 'ready' },
    ];
    await ctx.update();
    await page.evaluate(
      (label) => {
        const style = document.createElement('style');
        style.textContent =
          '.workspace { height: calc(100dvh - 52px) !important; } body { padding-top: 52px !important; box-sizing: border-box; } #guide-caption { position:fixed; inset:0 0 auto; height:52px; background:#181818; border-bottom:1px solid #333; z-index:99999; display:flex; align-items:center; justify-content:space-between; padding:0 24px; font:14px system-ui; color:#eee; } #guide-cursor { position:fixed; width:12px; height:12px; border:2px solid white; background:#73b4ff; border-radius:50%; pointer-events:none; z-index:100000; box-shadow:0 1px 4px #000; }';
        document.head.append(style);
        const caption = document.createElement('div');
        caption.id = 'guide-caption';
        caption.innerHTML = `<span></span><small style="color:#aaa">Claudex · ${label}</small>`;
        document.body.append(caption);
        const cursor = document.createElement('div');
        cursor.id = 'guide-cursor';
        document.body.append(cursor);
      },
      name === 'accounts' ? 'Sample accounts' : 'Sample conversation',
    );
    let frames: { file: string; duration: number }[] = [];
    let sequence = 0;
    async function caption(text: string) {
      await page.locator('#guide-caption span').evaluate((element, value) => {
        element.textContent = value;
      }, text);
    }
    async function frame(duration = 1000) {
      await page.waitForTimeout(200);
      const file = `${framesDir}/${sequence++}.png`;
      await page.screenshot({ path: file });
      frames.push({ file, duration });
    }
    async function click(target: Locator) {
      await target.scrollIntoViewIfNeeded();
      const bounds = await target.boundingBox();
      assert.ok(bounds);
      await page.locator('#guide-cursor').evaluate(
        (element, point) => {
          Object.assign((element as HTMLElement).style, {
            left: `${point.x}px`,
            top: `${point.y}px`,
          });
        },
        { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      );
      await frame(350);
      await target.click();
      await frame();
    }
    async function exportClip(name: string) {
      await writeFile(`${framesDir}/${name}.json`, JSON.stringify(frames));
      const result = spawnSync(
        'python3',
        ['scripts/encode-guide.py', `${framesDir}/${name}.json`, `${output}/${name}`],
        { stdio: 'inherit' },
      );
      assert.equal(result.status, 0, 'GIF encoding must succeed');
      frames = [];
    }
    function resetFrames() {
      frames = [];
    }
    await scenes({ ctx, page, caption, frame, click, exportClip, resetFrames });
    assert.deepEqual(errors.errors, []);
  } finally {
    await browser.close();
    preview.kill();
  }
}

export type Guide = {
  ctx: ReturnType<typeof createContext>;
  page: import('@playwright/test').Page;
  caption: (text: string) => Promise<void>;
  frame: (duration?: number) => Promise<void>;
  click: (target: Locator) => Promise<void>;
  exportClip: (name: string) => Promise<void>;
  resetFrames: () => void;
};
