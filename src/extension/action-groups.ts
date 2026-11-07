import type { Action } from '../shared/model';
import type { ActionHandlers } from './router';

export const actionGroups = {
  unrestricted: ['ready', 'openChat', 'select', 'setAppearance', 'setGuide', 'dismissOnboarding'],
  profiles: [
    'profileRequest',
    'refreshAgents',
    'addProfile',
    'saveProfile',
    'renameProfile',
    'removeProfile',
    'signInProfile',
    'openProfileFolder',
  ],
  catalog: [
    'setModel',
    'setThinking',
    'refreshModels',
    'refreshSkills',
    'openSkill',
    'setSkillEnabled',
  ],
  threads: [
    'compose',
    'continueChat',
    'start',
    'delegate',
    'send',
    'interrupt',
    'approve',
    'pin',
    'deleteThread',
    'rename',
    'worktree',
    'setMode',
  ],
  plans: ['buildPlan', 'keepPlanning', 'viewPlan', 'editPlan', 'savePlan'],
  documents: [
    'link',
    'document',
    'template',
    'handoff',
    'changes',
    'reviewChanges',
    'openDiff',
    'copy',
  ],
  attachments: ['previewContext', 'searchContext', 'pickImages', 'attachImage', 'openImage'],
  terminal: [
    'terminal',
    'terminalBack',
    'resumeInAuto',
    'refreshNativeSessions',
    'openNativeSession',
  ],
} as const satisfies Record<string, readonly Action['type'][]>;

type Group = keyof typeof actionGroups;
type GroupAction<G extends Group> = (typeof actionGroups)[G][number];
type RegisteredAction = GroupAction<Group>;
type DuplicatedAction = {
  [G in Group]: Extract<GroupAction<G>, GroupAction<Exclude<Group, G>>>;
}[Group];
type AssertNever<T extends never> = T;

// Schema additions and overlaps must be assigned to exactly one feature before compiling.
export type MissingActionHandlers = AssertNever<Exclude<Action['type'], RegisteredAction>>;
export type DuplicateActionHandlers = AssertNever<DuplicatedAction>;

export type HandlersFor<G extends Group> = ExclusiveHandlers<Pick<ActionHandlers, GroupAction<G>>>;
export type WorkspaceHandlers = HandlersFor<Exclude<Group, 'unrestricted' | 'profiles'>>;

// Optional never keys reject cross-group registrations even when maps arrive through spreads.
type ExclusiveHandlers<Handlers> = Handlers & {
  [Type in Exclude<Action['type'], keyof Handlers>]?: never;
};
