import type { AgentKind } from './agents';
import { mentionNames, resolveAgentName } from './profiles';

/** A leading `@name ` for any agent there is now. Ids are plain [a-z0-9-], so none need escaping. */
function leadingMention(): RegExp {
  return new RegExp(`^@(${mentionNames().join('|')})(?=\\s)`, 'i');
}
/** Reads `@codex do this`. Only a leading mention counts, so prose can still contain @names. */
export function parseMention(text: string): { agent: AgentKind; prompt: string } | undefined {
  const trimmed = text.trimStart();
  const match = leadingMention().exec(trimmed);
  const agent = match && resolveAgentName(match[1]);
  if (!match || !agent) return undefined;
  const prompt = trimmed.slice(match[0].length).trim();
  return prompt ? { agent, prompt } : undefined;
}
/** Who a leading mention names, as soon as it is complete, even before a prompt is written. */
export function mentionedAgent(text: string): AgentKind | undefined {
  const name = leadingMention().exec(text.trimStart())?.[1];
  return name ? resolveAgentName(name) : undefined;
}
/**
 * Picking an agent from the @ menu, anywhere in a message. Only a leading mention runs an agent,
 * so the pick moves there, and it replaces a mention already leading. Your words are kept.
 */
export function withMention(
  text: string,
  start: number,
  end: number,
  name: string,
): { text: string; caret: number } {
  const lead = new RegExp(`^\\s*@(?:${mentionNames().join('|')})\\s+`, 'i');
  const kept = text.slice(0, start).replace(lead, '').trimStart();
  const rest = text.slice(end);
  const prefix = `@${name} `;
  return {
    text: prefix + kept + (!kept || /\s$/.test(kept) ? rest.trimStart() : rest),
    caret: prefix.length + kept.length,
  };
}
/** The provider's own fallback for an unnamed session: the first line of the first prompt. */
/** A title to show: image references say nothing on their own, so they're left out. */
export function threadTitle(title: string, empty = 'Image'): string {
  return (
    title
      .replace(/\[Image #\d+\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || empty
  );
}
export function deriveTitle(prompt: string): string {
  const line =
    prompt
      .split('\n')
      .map((item) => item.trim())
      .find(Boolean) ?? '';
  const clean = line.replace(/\s+/g, ' ');
  if (!clean) return 'New thread';
  return clean.length > 60 ? `${clean.slice(0, 59).trimEnd()}…` : clean;
}

/** A plan's first heading, or the thread's title when it has none. */
export function planTitle(text: string, fallback: string): string {
  return /^#{1,3}\s+(.+)$/m.exec(text)?.[1]?.trim() || fallback;
}
/** The first paragraph of prose, for a card that doesn't repeat the whole plan. */
export function planSummary(text: string): string {
  for (const block of text.split(/\n\s*\n/)) {
    const line = block.trim();
    if (line && !/^(#|[-*+] |\d+\. |>|```|\|)/.test(line)) return line.replace(/\s+/g, ' ');
  }
  return '';
}
