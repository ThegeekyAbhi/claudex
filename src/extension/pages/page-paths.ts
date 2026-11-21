import { stat } from 'node:fs/promises';
import { resolveInside } from '../../providers/shared/paths';
import { filePart } from '../../shared/domain/file-refs';

/**
 * The references a page shows that name files in this workspace, so they can read as file chips.
 * Anything outside the workspace, missing, or a folder is left as plain text.
 */
export async function existingFiles(
  root: string,
  references: readonly string[],
): Promise<string[]> {
  const found = await Promise.all(
    references.map(async (reference) => {
      const relative = filePart(reference);
      if (!relative || relative.includes('\0')) return undefined;
      try {
        const info = await stat(await resolveInside(root, relative));
        return info.isFile() ? reference : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  return found.filter((reference): reference is string => reference !== undefined);
}
