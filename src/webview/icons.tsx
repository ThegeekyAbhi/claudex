import {
  Infinity as AgentLoop,
  ArrowLeftRight,
  ArrowUp,
  BookOpen,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Diff,
  Ellipsis,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Globe,
  History,
  Image,
  ListTodo,
  type LucideIcon,
  MessageCircleQuestion,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Save,
  Search,
  Sparkles,
  Square,
  SquareTerminal,
  Wrench,
  X,
} from 'lucide-react';
import type { AgentKind } from '../model';

const icons = {
  logo: Sparkles,
  history: History,
  plus: Plus,
  terminal: SquareTerminal,
  arrow: ArrowUp,
  stop: Square,
  file: FileText,
  branch: GitBranch,
  diff: Diff,
  chevron: ChevronRight,
  chevronDown: ChevronDown,
  chevronUp: ChevronUp,
  question: MessageCircleQuestion,
  close: X,
  swap: ArrowLeftRight,
  check: Check,
  search: Search,
  brain: Brain,
  read: BookOpen,
  edit: Pencil,
  globe: Globe,
  agent: Bot,
  wrench: Wrench,
  external: ExternalLink,
  x: X,
  copy: Copy,
  more: Ellipsis,
  folder: Folder,
  folderOpen: FolderOpen,
  image: Image,
  agentMode: AgentLoop,
  plan: ListTodo,
  thread: MessageSquare,
  clip: Paperclip,
  save: Save,
} satisfies Record<string, LucideIcon>;
export type IconName = keyof typeof icons;
export function Icon({ name, size = 15 }: { name: IconName; size?: number }) {
  const Glyph = icons[name];
  return (
    <Glyph
      size={size}
      strokeWidth={1.75}
      aria-hidden="true"
      {...(name === 'stop' ? { fill: 'currentColor' } : {})}
    />
  );
}
/** Lucide has no vendor logos, so these simple marks tell the agents apart. */
export function AgentMark({ agent, size = 14 }: { agent: AgentKind; size?: number }) {
  if (agent === 'codex')
    return (
      <svg
        className="agent-mark codex"
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m8 1.5 5.6 3.25v6.5L8 14.5l-5.6-3.25v-6.5L8 1.5Z" />
        <path d="m5.5 6.5 2 1.5-2 1.5M8.7 10h2" />
      </svg>
    );
  return (
    <svg
      className={`agent-mark ${agent}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" />
      {agent === 'claud2' ? (
        <circle cx="13" cy="13" r="1.6" fill="currentColor" stroke="none" />
      ) : null}
    </svg>
  );
}
