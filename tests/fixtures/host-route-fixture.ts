import assert from 'node:assert/strict';
import { actionGroups, type HandlersFor } from '../../src/extension/action-groups';
import type { ActionRoutes } from '../../src/extension/router';

type RouteOverrides = {
  [Group in 'unrestricted' | 'profiles' | 'workspace']?: Partial<ActionRoutes[Group]>;
} & Pick<Partial<ActionRoutes>, 'requireTrust'>;

function unexpectedHandlers<Group extends keyof typeof actionGroups>(
  group: Group,
): HandlersFor<Group> {
  return Object.fromEntries(
    actionGroups[group].map((type) => [type, () => assert.fail(`Unexpected action: ${type}`)]),
  ) as unknown as HandlersFor<Group>;
}

export function testRoutes(overrides: RouteOverrides = {}): ActionRoutes {
  return {
    unrestricted: { ...unexpectedHandlers('unrestricted'), ...overrides.unrestricted },
    profiles: { ...unexpectedHandlers('profiles'), ...overrides.profiles },
    workspace: {
      ...unexpectedHandlers('catalog'),
      ...unexpectedHandlers('threads'),
      ...unexpectedHandlers('plans'),
      ...unexpectedHandlers('documents'),
      ...unexpectedHandlers('attachments'),
      ...unexpectedHandlers('terminal'),
      ...overrides.workspace,
    },
    requireTrust: overrides.requireTrust ?? (() => {}),
  };
}
