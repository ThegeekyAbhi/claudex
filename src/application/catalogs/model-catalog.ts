import { withClaudeCatalog } from '../../providers/claude/catalog-probe';
import { initializeCodex } from '../../providers/codex/handshake';
import { JsonRpc } from '../../providers/process';
import type { ModelOption } from '../../shared/model';

/** Asks the installed Codex for its models. No thread or turn is started. */
export async function listCodexModels(
  executable: string,
  cwd: string,
  env?: Record<string, string>,
): Promise<ModelOption[]> {
  const rpc = new JsonRpc(
    executable,
    ['app-server', '--listen', 'stdio://'],
    cwd,
    () => {},
    () => {},
    env,
    { name: 'Codex' },
  );
  try {
    await initializeCodex(rpc, { experimentalApi: true });
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
  return withClaudeCatalog(
    {
      executable,
      cwd,
      env,
      settingSources: [],
      timeoutMs: 20_000,
      timeoutMessage: 'Claude did not answer in time.',
    },
    async (active) => {
      const models = await active.supportedModels();
      return models
        .filter((model) => model.value !== 'default')
        .map((model) => ({
          id: model.value,
          resolvedModel: model.resolvedModel,
          label: model.displayName,
          description: model.description,
          efforts: model.supportedEffortLevels ?? [],
          adaptiveThinking: Boolean(model.supportsAdaptiveThinking),
        }));
    },
  );
}
