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

/** The glyph for any chip that sits in your text: a path's file icon, a page, or a skill. */
export function InlineIcon({
  attachment,
}: {
  attachment: { kind: 'file' | 'folder'; path: string } | { kind: 'page' } | { kind: 'skill' };
}) {
  if (attachment.kind === 'file' || attachment.kind === 'folder')
    return <ReferenceIcon kind={attachment.kind} path={attachment.path} />;
  // A page carries the Claudex mark, as its editor tab does.
  if (attachment.kind === 'page')
    return (
      <span className="reference-icon" aria-hidden="true">
        <span className="claudex-mark" />
      </span>
    );
  return (
    <span className="reference-icon" aria-hidden="true">
      <Icon name="skill" size={14} />
    </span>
  );
}
