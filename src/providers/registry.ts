import type { Agent, Delegate, EventSink, Provider, Session, SkillRequest } from '../shared/model';
import { ClaudeAgent } from './claude/adapter';
import { CodexAgent } from './codex/adapter';
import type { ImageStore } from './shared/image-store';

export interface Launcher {
  executable: string;
  /** Extra environment for the CLI: CLAUDE_CONFIG_DIR or CODEX_HOME for a profile's own folder. */
  env?: Record<string, string>;
}
export interface ProviderDependencies {
  delegate?: Delegate;
  images?: ImageStore;
  skills: () => SkillRequest[];
}
export type ProviderFactory = (
  session: Session,
  launcher: Launcher,
  emit: EventSink,
  deps: ProviderDependencies,
) => Agent;

/** Concrete adapters are composed here, outside session orchestration. */
export const providerRegistry: Readonly<Record<Provider, ProviderFactory>> = {
  codex: (session, launcher, emit, deps) =>
    new CodexAgent(session, launcher.executable, emit, {
      env: launcher.env,
      delegate: deps.delegate,
      images: deps.images,
      skills: deps.skills,
    }),
  claude: (session, launcher, emit, deps) =>
    new ClaudeAgent(session, launcher.executable, emit, {
      env: launcher.env,
      delegate: deps.delegate,
      skills: deps.skills,
    }),
};
