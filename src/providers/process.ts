import { createInterface } from 'node:readline';
import { type ProviderProcess, spawnProvider, stopProcessTree } from './spawn';

export interface RpcMessage {
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: { message: string; code?: number };
}
export interface JsonRpcOptions {
  /** How errors name the program, such as “Codex”. */
  name?: string;
  /** Requests that may wait for an answer at once; more are refused rather than queued forever. */
  maxPending?: number;
  /** How long a request waits for its answer. */
  timeoutMs?: number;
}
export class JsonRpc {
  private child: ProviderProcess;
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private closed = false;
  private stderr = '';
  private readonly name: string;
  private readonly maxPending: number;
  private readonly timeoutMs: number;
  constructor(
    executable: string,
    args: string[],
    cwd: string,
    private onMessage: (message: RpcMessage) => void,
    private onClose: (error: Error) => void,
    /** Added to the environment, such as CODEX_HOME for a profile's own folder. */
    env?: Record<string, string>,
    options: JsonRpcOptions = {},
  ) {
    this.name = options.name ?? 'The provider';
    this.maxPending = options.maxPending ?? 256;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.child = spawnProvider(executable, args, { cwd, env });
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.stderr.on('data', (data) => this.note(String(data)));
    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => this.line(line));
    this.child.once('error', (error) => this.fail(error));
    this.child.once('close', (code, signal) =>
      this.fail(new Error(`${this.name} exited (${signal ?? code}). ${this.stderr}`.trim())),
    );
  }
  /** Kept for error messages; never parsed, since it can hold anything the CLI prints. */
  private note(text: string): void {
    this.stderr = (this.stderr + text).slice(-8000);
  }
  private line(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    // A CLI can print a warning to stdout before or between messages. That isn't a message, so it
    // is kept for diagnosis instead of ending the session. A broken message still ends it.
    if (!trimmed.startsWith('{')) {
      this.note(`${trimmed}\n`);
      return;
    }
    let message: RpcMessage;
    try {
      message = JSON.parse(trimmed) as RpcMessage;
    } catch (error) {
      this.fail(new Error(`Invalid response from ${this.name}: ${String(error)}`));
      this.stop();
      return;
    }
    if (typeof message.id === 'number' && !message.method && this.pending.has(message.id)) {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    } else this.onMessage(message);
  }
  request(method: string, params: unknown): Promise<any> {
    if (this.closed)
      return Promise.reject(new Error('Provider connection is closed. Send again to resume.'));
    if (this.pending.size >= this.maxPending)
      return Promise.reject(new Error(`${this.name} has too many unanswered requests.`));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }
  write(message: unknown): void {
    if (this.closed) throw new Error('Provider connection is closed.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  reply(id: string | number, result: unknown): void {
    this.write({ id, result });
  }
  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.onClose(error);
  }
  private stopped = false;
  private stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    stopProcessTree(this.child);
  }
  dispose(): void {
    this.fail(new Error('Provider disconnected.'));
    this.stop();
  }
}
