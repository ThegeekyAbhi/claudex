import { FileIcon } from '@react-symbols/icons/utils';
import { Icon } from './icons';

/** Keep the same filename-aware glyph in the editor, context menus and sent messages. */
export function ReferenceIcon({ kind, path }: { kind: 'file' | 'folder'; path: string }) {
  return (
    <span className="reference-icon" aria-hidden="true">
      {kind === 'folder' ? (
        <Icon name="folder" size={14} />
      ) : (
        <FileIcon fileName={path.split(/[/\\]/).pop() ?? path} autoAssign width={14} height={14} />
      )}
    </span>
  );
}
