import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { planTitle, type Session } from '../shared/model';

export const PLAN_SUFFIX = '.plan.md';

/**
 * Plans live in the extension's own storage rather than your repo, because plan mode can't
 * write files and a plan isn't always worth committing. Save to workspace is one click away.
 */
export class PlanStore {
  constructor(readonly folder: string) {}
  private fileFor(session: Session, text: string): string {
    const slug = planTitle(text, session.title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60);
    const id = session.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
    return path.join(this.folder, `${slug || 'plan'}_${id}${PLAN_SUFFIX}`);
  }
  /** A thread keeps one file, so a revised plan replaces the old one instead of piling up. */
  async save(session: Session, text: string): Promise<string> {
    const file = session.plan?.file ?? this.fileFor(session, text);
    await mkdir(this.folder, { recursive: true });
    await writeFile(file, `${text.trimEnd()}\n`, 'utf8');
    return file;
  }
  read(file: string): Promise<string> {
    return readFile(file, 'utf8');
  }
}
