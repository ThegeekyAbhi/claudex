import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import type { Approval, Question, Session } from '../model';
import { send } from './bridge';
import { Icon } from './icons';

const RECOMMENDED = /\s*\(recommended\)\s*$/i;
const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

interface Answer {
  chosen: string[];
  text: string;
}
const EMPTY: Answer = { chosen: [], text: '' };
export function isQuestion(approval?: Approval): boolean {
  return Boolean(approval?.questions?.length);
}
/** This thread's own question first, then one from a child running under it. */
export function pendingQuestion(
  session: Session | undefined,
  sessions: Session[],
): { approval: Approval; sessionId: string; from?: string } | undefined {
  if (!session) return undefined;
  if (session.approval && isQuestion(session.approval))
    return { approval: session.approval, sessionId: session.id };
  const child = sessions.find((item) => item.parentId === session.id && isQuestion(item.approval));
  return child?.approval
    ? { approval: child.approval, sessionId: child.id, from: child.title }
    : undefined;
}
function answerText(answer: Answer): string {
  return [...answer.chosen, answer.text.trim()].filter(Boolean).join(', ');
}
/** One question at a time, docked on the composer. Letters pick, Enter moves on, Esc skips. */
export function QuestionCard({
  approval,
  sessionId,
  from,
}: {
  approval: Approval;
  sessionId: string;
  from?: string;
}) {
  const questions: Question[] = approval.questions ?? [];
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [collapsed, setCollapsed] = useState(false);
  const card = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const promptId = useId();
  const question = questions[index];
  const answer = answers[question.id] ?? EMPTY;
  const last = index === questions.length - 1;
  const answered = (item: Question) => Boolean(answerText(answers[item.id] ?? EMPTY));
  const update = (next: Partial<Answer>) =>
    setAnswers((current) => ({
      ...current,
      [question.id]: { ...(current[question.id] ?? EMPTY), ...next },
    }));
  function pick(option: string) {
    if (question.multiple)
      update({
        chosen: answer.chosen.includes(option)
          ? answer.chosen.filter((item) => item !== option)
          : [...answer.chosen, option],
      });
    else update({ chosen: [option], text: '' });
  }
  function respond(allowed: boolean) {
    send({
      type: 'approve',
      id: sessionId,
      requestId: approval.id,
      allowed,
      answers: allowed
        ? Object.fromEntries(
            questions.map((item) => [item.id, answerText(answers[item.id] ?? EMPTY)]),
          )
        : {},
    });
    document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
  }
  function advance() {
    if (!answered(question)) return;
    if (!last) {
      setIndex(index + 1);
      return;
    }
    const missing = questions.findIndex((item) => !answered(item));
    if (missing >= 0) setIndex(missing);
    else respond(true);
  }
  // Never takes the keyboard from a message you are in the middle of writing.
  useEffect(() => {
    // One frame later, because opening a thread also focuses the composer.
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      const typing = active instanceof HTMLTextAreaElement && active.value.trim();
      if (!typing) card.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      respond(false);
      return;
    }
    const typing = event.target instanceof HTMLInputElement;
    if (event.key === 'Enter' && !event.shiftKey) {
      const target = event.target as HTMLElement;
      // Header and footer buttons keep their own Enter.
      if (target.closest('header, footer')) return;
      event.preventDefault();
      // Enter on an option you moved to with the arrows picks it first.
      if (target.getAttribute('aria-checked') === 'false') {
        target.click();
        return;
      }
      advance();
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const rows = [
        ...Array.from(
          card.current?.querySelectorAll<HTMLElement>('.question-option:not(.other), input') ?? [],
        ),
      ];
      if (!rows.length) return;
      event.preventDefault();
      const at = rows.indexOf(document.activeElement as HTMLElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      rows[(at + step + rows.length) % rows.length]?.focus();
      return;
    }
    if (event.key.length !== 1) return;
    const slot = KEYS.indexOf(event.key.toUpperCase());
    if (slot < 0) return;
    if (slot < question.options.length) {
      event.preventDefault();
      pick(question.options[slot]);
    } else if (slot === question.options.length) {
      event.preventDefault();
      input.current?.focus();
    }
  }
  const single = !question.multiple;
  return (
    <div className="question-dock">
      <section
        ref={card}
        className="question-card"
        aria-label="Agent questions"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header>
          <Icon name="question" size={14} />
          <strong>Questions</strong>
          {from ? <span className="question-from">{from}</span> : null}
          <span className="question-spacer" />
          {questions.length > 1 ? (
            <nav className="question-pager" aria-label="Questions">
              <button
                type="button"
                className="icon-button"
                aria-label="Previous question"
                disabled={index === 0}
                onClick={() => setIndex(index - 1)}
              >
                <Icon name="chevronUp" size={13} />
              </button>
              <span>
                {index + 1} of {questions.length}
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label="Next question"
                disabled={last}
                onClick={() => setIndex(index + 1)}
              >
                <Icon name="chevronDown" size={13} />
              </button>
            </nav>
          ) : null}
          <button
            type="button"
            className="icon-button"
            aria-label={collapsed ? 'Show questions' : 'Hide questions'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            <span className={`chevron ${collapsed ? '' : 'open'}`}>
              <Icon name="chevron" size={12} />
            </span>
          </button>
        </header>
        {collapsed ? null : (
          <>
            <div className="question-body">
              <p className="question-prompt" id={promptId}>
                {questions.length > 1 ? <span>{index + 1}.</span> : null}
                {question.prompt}
              </p>
              {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is always radiogroup or group, which Biome cannot read from the expression */}
              <div role={single ? 'radiogroup' : 'group'} aria-labelledby={promptId}>
                {question.options.map((option, slot) => {
                  const chosen = answer.chosen.includes(option);
                  const detail = question.details?.[option];
                  return (
                    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is always radio or checkbox, which Biome cannot read from the expression
                    <button
                      type="button"
                      key={option}
                      role={single ? 'radio' : 'checkbox'}
                      aria-checked={chosen}
                      className="question-option"
                      onClick={() => pick(option)}
                    >
                      <kbd>{KEYS[slot]}</kbd>
                      <span className="question-label">
                        <span>
                          {option.replace(RECOMMENDED, '')}
                          {RECOMMENDED.test(option) ? <em>Recommended</em> : null}
                        </span>
                        {detail ? <small>{detail}</small> : null}
                      </span>
                      {chosen ? <Icon name="check" size={13} /> : null}
                    </button>
                  );
                })}
                <label className="question-option other">
                  {question.options.length ? <kbd>{KEYS[question.options.length]}</kbd> : null}
                  <input
                    ref={input}
                    aria-label={`Answer: ${question.prompt}`}
                    placeholder={question.options.length ? 'Something else…' : 'Type your answer…'}
                    value={answer.text}
                    onChange={(event) =>
                      update({
                        text: event.target.value,
                        ...(single && event.target.value ? { chosen: [] } : {}),
                      })
                    }
                  />
                </label>
              </div>
            </div>
            <footer>
              <button
                type="button"
                className="question-skip"
                title="Skip these questions. The agent is told you declined."
                onClick={() => respond(false)}
              >
                Skip <kbd>Esc</kbd>
              </button>
              <button
                type="button"
                className="question-continue"
                disabled={!answered(question)}
                onClick={advance}
              >
                {last ? 'Send' : 'Continue'} <kbd>⏎</kbd>
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
