import { TERMINAL_STATUSES } from '../domain/agents';
import type { AgentEvent, Message, Session, TranscriptEvent } from '../domain/session';

export function applyTranscript(
  session: Session,
  event: TranscriptEvent,
  index?: Map<string, Message>,
): void {
  const id = event.type === 'message' ? event.message.id : event.id;
  const existing = index ? index.get(id) : session.messages.find((message) => message.id === id);
  if (event.type === 'message') {
    const ended = event.message.role === 'thinking' ? { endedAt: Date.now() } : {};
    if (existing) Object.assign(existing, event.message, ended);
    else {
      const added = { startedAt: Date.now(), ...event.message, ...ended };
      session.messages.push(added);
      index?.set(id, added);
    }
  } else if (event.type === 'delta') {
    if (existing) existing.text += event.text;
    else {
      const added: Message = {
        id,
        role: event.role ?? 'assistant',
        text: event.text,
        startedAt: Date.now(),
      };
      session.messages.push(added);
      index?.set(id, added);
    }
  } else if (existing) {
    if (event.text !== undefined) existing.text = event.text;
    if (event.tool && existing.tool) existing.tool = { ...existing.tool, ...event.tool };
    if (event.tool?.status && event.tool.status !== 'running') existing.endedAt = Date.now();
  }
}
/** The last message the transcript shows, so the plan has a visible place to follow. */
function planAnchor(messages: Session['messages']): { after?: string } {
  for (let index = messages.length - 1; index >= 0; index--)
    if (!messages[index].tool?.diffSource) return { after: messages[index].id };
  return {};
}
export function applyEvent(session: Session, event: AgentEvent): void {
  session.updatedAt = Date.now();
  if (event.type === 'status') {
    session.status = event.status;
    if (event.status !== 'waiting') delete session.approval;
    if (session.plan?.status === 'drafting' && TERMINAL_STATUSES.includes(event.status))
      session.plan.status = 'incomplete';
  } else if (event.type === 'plan') {
    const drafting = session.plan?.status === 'drafting';
    session.plan = {
      text: event.final || !drafting ? event.text : `${session.plan?.text ?? ''}${event.text}`,
      status: event.final ? 'ready' : 'drafting',
      updatedAt: Date.now(),
      ...(session.plan?.file ? { file: session.plan.file } : {}),
      // Streamed parts of one plan keep the place the plan began; a new plan takes a new one.
      ...(drafting && session.plan?.after
        ? { after: session.plan.after }
        : planAnchor(session.messages)),
    };
  } else if (event.type === 'nativeId') {
    session.nativeId = event.id;
    // The CLI made the branch; later turns resume it like any other session.
    if (session.forkFrom && event.id !== session.forkFrom.nativeId) delete session.forkFrom;
  } else if (event.type === 'nativeTurn') {
    for (let index = session.messages.length - 1; index >= 0; index--)
      if (session.messages[index].role === 'user') {
        session.messages[index].nativeTurn = event.ref;
        if (session.nativeId) session.messages[index].nativeSession = session.nativeId;
        session.messages[index].nativeOwner = {
          provider: session.provider,
          ...(session.profileId ? { profileId: session.profileId } : {}),
        };
        break;
      }
  } else if (event.type === 'activeModel') session.activeModel = event.model;
  else if (event.type === 'reportedMode') session.reportedMode = event.mode;
  else if (event.type === 'runtime')
    session.runtime = { ...session.runtime, ...event.runtime, observedAt: Date.now() };
  else if (event.type === 'nativeSettings') session.nativeSettings ??= event.settings;
  else if (event.type === 'usage') {
    const limits = new Map((session.usage?.limits ?? []).map((item) => [item.id, item]));
    for (const limit of event.limits ?? []) limits.set(limit.id, limit);
    const context = event.context ?? session.usage?.context;
    session.usage = {
      ...(context ? { context } : {}),
      ...(limits.size ? { limits: [...limits.values()] } : {}),
      updatedAt: Date.now(),
    };
  } else if (event.type === 'approval') {
    session.approval = event.approval;
    session.status = 'waiting';
  } else if (event.type === 'message' || event.type === 'delta' || event.type === 'patch')
    applyTranscript(session, event);
}
