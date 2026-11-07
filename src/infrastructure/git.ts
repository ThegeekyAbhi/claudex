import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execute('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return result.stdout;
}
