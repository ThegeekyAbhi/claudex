import { type Action, actionSchema } from '../shared/model';
import { type ActionFailure, actionFailure } from '../shared/protocol/failures';
import type { HandlersFor, WorkspaceHandlers } from './action-groups';
import type { Surface } from './surfaces';

export type ActionHandlers = {
  [Type in Action['type']]: (
    action: Extract<Action, { type: Type }>,
    surface: Surface,
  ) => void | Promise<void>;
};

export interface ActionRoutes {
  unrestricted: HandlersFor<'unrestricted'>;
  profiles: HandlersFor<'profiles'>;
  workspace: WorkspaceHandlers;
  requireTrust(): void;
}

function dispatch(
  action: Action,
  surface: Surface,
  handlers: Partial<ActionHandlers>,
): void | Promise<void> {
  // The key and payload share the discriminant checked by actionSchema.
  const handler = handlers[action.type] as
    | ((action: Action, surface: Surface) => void | Promise<void>)
    | undefined;
  return handler?.(action, surface);
}

async function dispatchProfile(
  action: Action,
  surface: Surface,
  handlers: Partial<ActionHandlers>,
): Promise<boolean> {
  if (!handlers[action.type]) return false;
  await dispatch(action, surface, handlers);
  return true;
}

export class RoutedActionError extends Error {
  constructor(
    error: unknown,
    readonly operation: ActionFailure | undefined,
  ) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
  }
}

export async function routeAction(
  raw: unknown,
  surface: Surface,
  routes: ActionRoutes,
): Promise<void> {
  const action = actionSchema.parse(raw);
  try {
    await dispatchAction(action, surface, routes);
  } catch (error) {
    throw new RoutedActionError(error, actionFailure(action));
  }
}

async function dispatchAction(
  action: Action,
  surface: Surface,
  routes: ActionRoutes,
): Promise<void> {
  if (routes.unrestricted[action.type]) {
    await dispatch(action, surface, routes.unrestricted);
    return;
  }
  // Keep profile actions before the trust gate, including the asynchronous boundary.
  if (await dispatchProfile(action, surface, routes.profiles)) return;
  routes.requireTrust();
  await dispatch(action, surface, routes.workspace);
}
