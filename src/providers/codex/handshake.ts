import type { JsonRpc } from '../process';

// Protocol client metadata is kept stable independently of the extension's release version.
const CLIENT_INFO = { name: 'agent_workspace', title: 'Agent Workspace', version: '0.6.0' };

export async function initializeCodex(
  rpc: Pick<JsonRpc, 'request' | 'write'>,
  capabilities: { experimentalApi: boolean },
): Promise<void> {
  await rpc.request('initialize', { clientInfo: { ...CLIENT_INFO }, capabilities });
  rpc.write({ method: 'initialized' });
}
