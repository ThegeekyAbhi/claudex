import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import path from 'node:path';

/** A provider process started with piped stdio. */
export type ProviderProcess = ChildProcessWithoutNullStreams;

/**
 * The one place a provider CLI is started. Everything that runs Claude Code, Codex, or a helper
 * process for them goes through here, so every OS gets the same launch and shutdown rules.
 */
export interface ProviderSpawnOptions {
  cwd?: string;
  /** Added to the extension host's environment, such as CODEX_HOME for a profile's own folder. */
  env?: Record<string, string>;
  /** Test seam; the host's platform when omitted. */
  platform?: NodeJS.Platform;
}

/**
 * The host environment plus extras. Windows treats variable names without regard to case, but a
 * copied `process.env` is a plain object, so `Path` and `PATH` would both be passed and the child
 * would see either one. An extra replaces any name that differs only in case.
 */
export function mergeEnv(
  extra: Record<string, string> | undefined,
  base: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...base };
  if (!extra) return merged;
  for (const [key, value] of Object.entries(extra)) {
    if (platform === 'win32') {
      const upper = key.toUpperCase();
      for (const existing of Object.keys(merged))
        if (existing !== key && existing.toUpperCase() === upper) delete merged[existing];
    }
    merged[key] = value;
  }
  return merged;
}

/** Characters cmd.exe treats specially, escaped with a caret. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/**
 * Quotes one argument for `cmd.exe /d /s /c "…"` so the program behind a .cmd/.bat file receives
 * it exactly. First the rules the C runtime uses to split a command line, then cmd's own escapes.
 * npm's launchers forward `%*` to another program, which parses the line again, so the cmd escapes
 * are applied twice for them. This is the scheme the widely used cross-spawn package uses.
 */
export function quoteCmdArg(arg: string, forwarded = true): string {
  let quoted = arg
    // Backslashes before a quote are doubled, and the quote escaped.
    .replace(/(\\*)"/g, '$1$1\\"')
    // Trailing backslashes are doubled so they don't escape the closing quote.
    .replace(/(\\*)$/, '$1$1');
  quoted = `"${quoted}"`.replace(CMD_META, '^$1');
  return forwarded ? quoted.replace(CMD_META, '^$1') : quoted;
}

export interface LaunchSpec {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

/**
 * How to start `executable`. A native program starts directly, never through a shell. Windows
 * can't start a .cmd/.bat file without cmd.exe (Node refuses since its 2024 security fix), so only
 * that case goes through cmd.exe, with every argument quoted, rather than turning on `shell`.
 */
export function launchSpec(
  executable: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  comspec: string = process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe',
): LaunchSpec {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(executable))
    return { command: executable, args };
  // cmd.exe stops reading a command at a line break, so the rest of an argument would be lost.
  // Refused instead, since no quoting can carry one through.
  const unsafe = args.find((arg) => /[\r\n\0]/.test(arg));
  if (unsafe !== undefined)
    throw new Error(
      `${path.basename(executable)} is a Windows command script, which can't receive an argument containing a line break.`,
    );
  const line = [executable.replace(CMD_META, '^$1'), ...args.map((arg) => quoteCmdArg(arg))].join(
    ' ',
  );
  return {
    command: comspec,
    args: ['/d', '/s', '/c', `"${line}"`],
    windowsVerbatimArguments: true,
  };
}

/**
 * Starts a provider CLI with piped stdio. On macOS and Linux it leads its own process group, so
 * stopping it also stops the commands and MCP servers it started. Windows gets no console window.
 */
export function spawnProvider(
  executable: string,
  args: string[],
  options: ProviderSpawnOptions = {},
): ChildProcessWithoutNullStreams {
  const platform = options.platform ?? process.platform;
  const spec = launchSpec(executable, args, platform);
  return spawn(spec.command, spec.args, {
    cwd: options.cwd,
    env: mergeEnv(options.env, process.env, platform),
    stdio: 'pipe',
    shell: false,
    windowsHide: true,
    ...(spec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    // A group of its own, so the whole tree can be signalled. Not on Windows, where it would
    // open a new console window instead.
    detached: platform !== 'win32',
  });
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    // A negative pid is the process group this child leads, so its own children go too.
    process.kill(-pid, signal);
  } catch {
    // Already gone, which is the goal.
  }
}

/**
 * Windows' own taskkill, by full path, so a PATH that lacks System32 or holds another program of
 * the same name can't change what stops the provider.
 */
export function taskkillPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir ?? env.WINDIR ?? 'C:\\Windows';
  return path.win32.join(root, 'System32', 'taskkill.exe');
}

function running(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode === null && child.signalCode === null;
}

/**
 * Stops a process started by `spawnProvider` and the processes it started. It is first asked to
 * finish (its input closes, then SIGTERM on macOS and Linux), and after `graceMs` anything left
 * is ended. Only the tree we started is touched. On Windows a provider that already exited is
 * trusted to have closed its own children, because Windows can't find a dead parent's tree.
 */
export function stopProcessTree(
  child: ChildProcessWithoutNullStreams,
  options: { graceMs?: number; platform?: NodeJS.Platform } = {},
): void {
  const platform = options.platform ?? process.platform;
  const graceMs = options.graceMs ?? 2000;
  const pid = child.pid;
  child.stdin.end();
  if (pid === undefined) return;
  if (platform !== 'win32') signalGroup(pid, 'SIGTERM');
  const timer = setTimeout(() => {
    if (platform === 'win32') {
      if (!running(child)) return;
      const killer = spawn(taskkillPath(), ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => child.kill());
      killer.unref();
    } else {
      // Children can outlive the leader, so the group is ended even when the leader has exited.
      signalGroup(pid, 'SIGKILL');
    }
  }, graceMs);
  timer.unref();
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs a short command, such as `--version`, and collects what it prints. Rejects when it can't
 * start or doesn't finish within `timeoutMs`; a nonzero exit resolves with its code.
 */
export function runProvider(
  executable: string,
  args: string[],
  options: ProviderSpawnOptions & { timeoutMs?: number; maxBytes?: number } = {},
): Promise<RunResult> {
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnProvider(executable, args, options);
    } catch (error) {
      reject(error as Error);
      return;
    }
    const out: Buffer[] = [];
    let size = 0;
    let stderr = '';
    const timer = setTimeout(() => {
      stopProcessTree(child, { graceMs: 500, platform: options.platform });
      reject(new Error(`${path.basename(executable)} did not finish in time.`));
    }, options.timeoutMs ?? 8000);
    timer.unref();
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= maxBytes) out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + String(chunk)).slice(-4000);
    });
    child.stdin.end();
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr });
    });
  });
}
