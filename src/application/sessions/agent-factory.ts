import { type Launcher, providerRegistry } from '../../providers/registry';
import type { ImageStore } from '../../providers/shared/image-store';
import type { PageTools, Provider, Session, SkillRequest } from '../../shared/model';
import type { AgentFactory } from './session-types';

export type { Launcher } from '../../providers/registry';
/** Resolves the CLI for a provider and profile. A string is an executable with no extra env. */
export type LauncherLookup = (provider: Provider, profileId?: string) => string | Launcher;
export function createAgentFactory(
  paths: LauncherLookup,
  images?: ImageStore,
  skills?: (session: Session) => SkillRequest[],
  /** Your pages, as tools for the thread's agent. */
  pages?: (session: Session) => PageTools | undefined,
): AgentFactory {
  const resolve = (session: Session): Launcher => {
    const value = paths(session.provider, session.profileId);
    return typeof value === 'string' ? { executable: value } : value;
  };
  return (session, emit, delegate) =>
    providerRegistry[session.provider](session, resolve(session), emit, {
      delegate,
      images,
      skills: () => skills?.(session) ?? [],
      pages: pages?.(session),
    });
}
