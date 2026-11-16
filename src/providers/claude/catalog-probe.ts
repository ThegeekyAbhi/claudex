import type { Options, Query } from '@anthropic-ai/claude-agent-sdk';
import { mergeEnv } from '../spawn';

type CatalogQuery = Pick<Query, 'supportedCommands' | 'supportedModels' | 'close'>;
type CreateQuery = (input: { prompt: AsyncIterable<never>; options: Options }) => CatalogQuery;

interface ProbeOptions {
  executable: string;
  cwd: string;
  env?: Record<string, string>;
  settingSources: NonNullable<Options['settingSources']>;
  timeoutMs: number;
  timeoutMessage: string;
  signal?: AbortSignal;
}

/** Holds an empty SDK input open for metadata only; no prompt or turn is submitted. */
export async function withClaudeCatalog<T>(
  options: ProbeOptions,
  work: (query: CatalogQuery) => Promise<T>,
  loadQuery: () => Promise<CreateQuery> = async () =>
    (await import('@anthropic-ai/claude-agent-sdk')).query,
): Promise<T> {
  const { signal } = options;
  signal?.throwIfAborted();
  const createQuery = await loadQuery();
  signal?.throwIfAborted();
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const idle: AsyncIterable<never> = {
    [Symbol.asyncIterator]: () => ({
      next: () => held.then(() => ({ done: true as const, value: undefined })),
    }),
  };
  const active = createQuery({
    prompt: idle,
    options: {
      cwd: options.cwd,
      pathToClaudeCodeExecutable: options.executable,
      settingSources: options.settingSources,
      ...(options.env ? { env: mergeEnv(options.env) } : {}),
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  try {
    const interrupted = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(options.timeoutMessage)), options.timeoutMs);
      timer.unref?.();
      abort = () => reject(signal?.reason ?? new Error('The catalog request was aborted.'));
      signal?.addEventListener('abort', abort, { once: true });
    });
    signal?.throwIfAborted();
    return await Promise.race([work(active), interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    release();
    active.close();
  }
}
