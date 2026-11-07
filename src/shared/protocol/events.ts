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
      ...(session.messages.length ? { after: session.messages.at(-1)?.id } : {}),
    };
  } else if (event.type === 'nativeId') session.nativeId = event.id;
  else if (event.type === 'activeModel') session.activeModel = event.model;
  else if (event.type === 'reportedMode') session.reportedMode = event.mode;
  else if (event.type === 'runtime') session.runtime = { ...session.runtime, ...event.runtime };
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
