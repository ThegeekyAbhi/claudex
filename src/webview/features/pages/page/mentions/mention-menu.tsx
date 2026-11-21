import { Icon } from '../../../../components/icons';
import type { MentionState, PageEditor } from '../../editor/types';
import { Floating } from '../../shared/floating';
import type { MentionGroup, MentionItem } from './mention-items';

/** The `@` menu, under what you're typing. */
export function MentionMenu({
  mention,
  editor,
  groups,
  flat,
  index,
  setIndex,
}: {
  mention: MentionState;
  editor: PageEditor;
  groups: MentionGroup[];
  flat: MentionItem[];
  index: number;
  setIndex: (index: number) => void;
}) {
  return (
    <Floating left={mention.left} top={mention.top + 6} label="Mention">
      <div className="max-h-[320px] w-[300px] overflow-y-auto p-1">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="px-2 pt-1.5 pb-1 text-[11px] text-faint">{group.label}</div>
            {group.items.map((item) => {
              const at = flat.indexOf(item);
              return (
                <button
                  key={item.key}
                  type="button"
                  role="option"
                  aria-selected={at === index}
                  data-active={at === index}
                  onMouseEnter={() => setIndex(at)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    item.run(editor, mention);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] data-[active=true]:bg-muted"
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground">
                    {typeof item.icon === 'string' ? (
                      <Icon name={item.icon} size={14} />
                    ) : (
                      item.icon.emoji
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.detail ? (
                    <span className="max-w-[45%] truncate text-[11px] text-faint">
                      {item.detail}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </Floating>
  );
}
