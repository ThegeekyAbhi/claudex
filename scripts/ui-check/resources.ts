import type { ChildProcess } from 'node:child_process';

export function waitForPreview(preview: ChildProcess, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const finish = (error?: Error) => {
      clearTimeout(timer);
      preview.stdout?.off('data', onData);
      preview.off('error', onError);
      preview.off('exit', onExit);
      if (error) reject(error);
      else resolve();
    };
    const onData = (data: Buffer | string) => {
      output += data.toString();
      if (output.includes('Design preview: http://127.0.0.1:4173')) finish();
    };
    const onError = (error: Error) => finish(error);
    const onExit = (code: number | null) => finish(new Error(`Preview exited: ${code}`));
    const timer = setTimeout(
      () => finish(new Error(`Preview did not become ready within ${timeoutMs} ms`)),
      timeoutMs,
    );
    preview.stdout?.on('data', onData);
    preview.once('error', onError);
    preview.once('exit', onExit);
  });
}

export async function stopPreview(preview: ChildProcess, timeoutMs = 2_000): Promise<void> {
  if (!preview.pid || preview.exitCode !== null || preview.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(terminateTimer);
      clearTimeout(killTimer);
      preview.off('exit', onExit);
      preview.off('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onExit = () => finish();
    const onError = (error: Error) => finish(error);
    const terminateTimer = setTimeout(() => preview.kill('SIGKILL'), timeoutMs);
    const killTimer = setTimeout(
      () => finish(new Error('Preview did not exit after SIGKILL')),
      timeoutMs * 2,
    );
    preview.once('exit', onExit);
    preview.once('error', onError);
    preview.kill('SIGTERM');
  });
}

interface Dependencies<Browser extends { close(): Promise<void> }, Page> {
  startPreview(): ChildProcess;
  waitForPreview(preview: ChildProcess): Promise<void>;
  stopPreview(preview: ChildProcess): Promise<void>;
  launchBrowser(): Promise<Browser>;
  createPage(browser: Browser): Promise<Page>;
  prepareOutput(): Promise<unknown>;
  run(page: Page): Promise<void>;
  reportFailure(page: Page, error: unknown): Promise<void>;
}

export async function withUIResources<Browser extends { close(): Promise<void> }, Page>(
  deps: Dependencies<Browser, Page>,
): Promise<void> {
  let preview: ChildProcess | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  const errors: unknown[] = [];
  try {
    preview = deps.startPreview();
    await deps.waitForPreview(preview);
    browser = await deps.launchBrowser();
    page = await deps.createPage(browser);
    await deps.prepareOutput();
    await deps.run(page);
  } catch (error) {
    errors.push(error);
    if (page !== undefined) {
      try {
        await deps.reportFailure(page, error);
      } catch (reportError) {
        errors.push(reportError);
      }
    }
  } finally {
    const cleanup = await Promise.allSettled([
      Promise.resolve().then(() => browser?.close()),
      Promise.resolve().then(() => (preview ? deps.stopPreview(preview) : undefined)),
    ]);
    for (const result of cleanup) if (result.status === 'rejected') errors.push(result.reason);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'UI checks or resource cleanup failed');
}
