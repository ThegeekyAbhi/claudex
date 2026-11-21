export function Outline({
  items,
  onPick,
}: {
  items: { text: string; level: number; pos: number }[];
  onPick: (pos: number) => void;
}) {
  const sections = items.filter((item, index) => !(index === 0 && item.level === 1));
  if (sections.length < 2) return null;
  return (
    <nav
      aria-label="Outline"
      className="page-outline group fixed top-24 left-3 z-10 flex flex-col gap-1.5 rounded-lg p-2 hover:bg-overlay hover:shadow-md max-[1100px]:hidden"
    >
      {sections.map((item) => (
        <button
          key={item.pos}
          type="button"
          onClick={() => onPick(item.pos)}
          className="flex items-center gap-2 text-left text-[12px] text-muted-foreground hover:text-foreground"
          style={{ paddingLeft: (item.level - 1) * 8 }}
        >
          <span
            aria-hidden="true"
            className="h-[2px] shrink-0 rounded-full bg-faint"
            style={{ width: 16 - item.level * 3 }}
          />
          <span className="hidden max-w-[200px] truncate group-hover:inline">{item.text}</span>
        </button>
      ))}
    </nav>
  );
}
