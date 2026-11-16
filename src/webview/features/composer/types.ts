import type {
  AgentKind,
  AgentMode,
  Attachment,
  Catalog,
  Preferences,
  Session,
  SkillCatalogs,
} from '../../../shared/model';
import type { ComposeChoice } from '../../app/bridge';
import type { ContextResults } from '../attachments/context-menu';

export interface ComposerProps {
  catalog: Catalog;
  skills: SkillCatalogs;
  /** Opens the Skills page, carrying what was typed after `/`. */
  onManageSkills: (query?: string) => void;
  session?: Session;
  sessions: Session[];
  project: string;
  /** Used until a thread exists. */
  choice: ComposeChoice;
  draft: string;
  attachments: Attachment[];
  draftKey: string;
  busy: boolean;
  /** A submitted message is still waiting for host acceptance. Editing stays available. */
  submissionPending?: boolean;
  trusted: boolean;
  focusKey: string;
  /** At the top of a new thread, so menus open downward. */
  top?: boolean;
  contextResults?: ContextResults;
  onDraft: (text: string) => void;
  onAttachments: (attachments: Attachment[]) => void;
  onChoice: (choice: ComposeChoice, carryDraft?: boolean) => void;
  /** Remembers an explicit choice for this agent's next new thread. */
  onMode: (agent: AgentKind, mode: AgentMode) => void;
  dismissedNudges: string[];
  onDismissNudge: (key: string) => void;
  onSubmit: () => void;
  onError: (text: string) => void;
  preferences: Preferences;
}
