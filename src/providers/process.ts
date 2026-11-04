import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface RpcMessage {
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: { message: string; code?: number };
}
export class JsonRpc {
  private child: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private closed = false;
  private stderr = '';
  constructor(
    executable: string,
    args: string[],
    cwd: string,
    private onMessage: (message: RpcMessage) => void,
    private onClose: (error: Error) => void,
  ) {
    this.child = spawn(executable, args, { cwd, stdio: 'pipe', env: process.env });
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.stderr.on('data', (data) => {
      this.stderr = (this.stderr + String(data)).slice(-8000);
    });
    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => {
      try {
        const message = JSON.parse(line) as RpcMessage;
        if (typeof message.id === 'number' && !message.method && this.pending.has(message.id)) {
          const request = this.pending.get(message.id);
          if (!request) return;
          this.pending.delete(message.id);
          clearTimeout(request.timer);
          if (message.error) request.reject(new Error(message.error.message));
          else request.resolve(message.result);
        } else this.onMessage(message);
      } catch (error) {
        this.fail(new Error(`Invalid provider response: ${String(error)}`));
        this.child.kill();
      }
    });
    this.child.once('error', (error) => this.fail(error));
    this.child.once('close', (code, signal) =>
      this.fail(new Error(`Codex exited (${signal ?? code}). ${this.stderr}`)),
    );
  }
  request(method: string, params: unknown): Promise<any> {
    if (this.closed)
      return Promise.reject(new Error('Provider connection is closed. Send again to resume.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, 60_000);
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
  dispose(): void {
    this.fail(new Error('Provider disconnected.'));
    this.child.stdin.end();
    this.child.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (this.child.exitCode === null && this.child.signalCode === null)
        this.child.kill('SIGKILL');
    }, 2000);
    timer.unref();
  }
}
