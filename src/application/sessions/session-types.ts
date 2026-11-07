import type { Agent, Delegate, EventSink, Session } from '../../shared/model';

export type AgentFactory = (session: Session, emit: EventSink, delegate?: Delegate) => Agent;
export interface PlanFiles {
  save(session: Session, text: string): Promise<string>;
  read(file: string): Promise<string>;
}
