import { realpath } from 'node:fs/promises';
import path from 'node:path';

export async function resolveInside(root: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative)) throw new Error('Expected a workspace-relative path.');
  const resolvedRoot = await realpath(root);
  const resolved = await realpath(path.resolve(root, relative));
  const rel = path.relative(resolvedRoot, resolved);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
    throw new Error('That path is outside this workspace.');
  return resolved;
}
