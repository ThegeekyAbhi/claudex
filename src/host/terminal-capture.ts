import * as vscode from 'vscode';

const MAX_OUTPUT = 20_000;
/** Keeps each terminal's last command output, where shell integration reports it. */
export class TerminalCapture {
  private output = new WeakMap<vscode.Terminal, string>();
  constructor(private onError: (text: string) => void) {}
  async capture(event: vscode.TerminalShellExecutionStartEvent): Promise<void> {
    let text = '';
    try {
      for await (const chunk of event.execution.read()) text = `${text}${chunk}`.slice(-MAX_OUTPUT);
    } catch (error) {
      this.onError(`Terminal output: ${String(error)}`);
    }
    // biome-ignore lint/suspicious/noControlCharactersInRegex: this removes terminal escape codes
    const clean = text.replace(/\u001b(?:\][^\u0007]*\u0007|\[[0-9;?]*[A-Za-z])/g, '');
    this.output.set(event.terminal, `$ ${event.execution.commandLine.value}\n${clean}`);
  }
  text(name: string): string | undefined {
    const terminal = vscode.window.terminals.find((item) => item.name === name);
    return terminal && this.output.get(terminal);
  }
  names(): string[] {
    return vscode.window.terminals
      .filter((terminal) => this.output.has(terminal))
      .map((terminal) => terminal.name);
  }
}
