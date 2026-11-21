/** A workspace path as written in a page or reply: `src/app.ts`, `./src/app.ts:12`, `a%20b.md`. */
export const FILE_REFERENCE =
  /^(?:\.\/)?(?:[\w.@+-]+\/)*[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,10}(?::\d+(?:-\d+)?)?$/;

/** `src/app.ts:12` or `src/app.ts:12-20` names the file `src/app.ts`. */
export function filePart(reference: string): string {
  let value = reference.trim().replace(/:\d+(?:-\d+)?$/, '');
  try {
    value = decodeURI(value);
  } catch {
    // Keep it as written.
  }
  return value.replace(/^\.\//, '');
}
