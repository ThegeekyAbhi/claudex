import type { ModelOption } from '../model';
import { JsonRpc } from './process';

function within<T>(promise: Promise<T>, label: string, ms = 20_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not answer in time.`)), ms);
    timer.unref?.();
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
/** Asks the installed Codex for its models. No thread or turn is started. */
export async function listCodexModels(executable: string, cwd: string): Promise<ModelOption[]> {
  const rpc = new JsonRpc(
    executable,
    ['app-server', '--listen', 'stdio://'],
    cwd,
    () => {},
    () => {},
  );
  try {
    await rpc.request('initialize', {
      clientInfo: { name: 'agent_workspace', title: 'Agent Workspace', version: '0.5.0' },
      capabilities: { experimentalApi: true },
    });
    rpc.write({ method: 'initialized' });
    const models: ModelOption[] = [];
    let cursor: string | null = null;
    do {
      const page: any = await rpc.request('model/list', cursor ? { cursor } : {});
      for (const model of page.data ?? []) {
        if (model.hidden) continue;
        models.push({
          id: model.model ?? model.id,
          label: model.displayName ?? model.id,
          description: model.description ?? '',
          efforts: (model.supportedReasoningEfforts ?? []).map((item: any) => item.reasoningEffort),
          defaultEffort: model.defaultReasoningEffort ?? undefined,
          isDefault: Boolean(model.isDefault),
          ...(Array.isArray(model.inputModalities)
            ? { images: model.inputModalities.includes('image') }
            : {}),
        });
      }
      cursor = page.nextCursor ?? null;
    } while (cursor);
    return models;
  } finally {
    rpc.dispose();
  }
}
/** Asks the installed Claude Code for its models. The prompt stream stays empty, so no turn runs. */
export async function listClaudeModels(
  executable: string,
  cwd: string,
  env?: Record<string, string>,
): Promise<ModelOption[]> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const idle: AsyncIterable<never> = {
    [Symbol.asyncIterator]: () => ({
      next: () => held.then(() => ({ done: true as const, value: undefined })),
    }),
  };
  const active = query({
    prompt: idle,
    options: {
      cwd,
      pathToClaudeCodeExecutable: executable,
      settingSources: [],
      ...(env ? { env: { ...process.env, ...env } } : {}),
    },
  });
  try {
    const models = await within(active.supportedModels(), 'Claude');
    return models
      .filter((model) => model.value !== 'default')
      .map((model) => ({
        id: model.value,
        label: model.displayName,
        description: model.description,
        efforts: model.supportedEffortLevels ?? [],
        adaptiveThinking: Boolean(model.supportsAdaptiveThinking),
      }));
  } finally {
    release();
    active.close();
  }
}
