import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import type { Approval, Question, Session } from '../../../core/model';
import { send } from '../../app/bridge';
import { Icon } from '../../components/icons';

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
    <div className="question-dock pt-2 px-6 pb-0 shrink-0 relative max-[900px]:px-3">
      <section
        ref={card}
        className="question-card max-w-[780px] mt-0 mx-auto -mb-2.5 pb-2.5 border border-strong rounded-t-lg bg-canvas outline-none max-h-[56vh] flex flex-col [&_header]:flex [&_header]:items-center [&_header]:gap-1.5 [&_header]:min-h-8 [&_header]:py-0.5 [&_header]:pr-1 [&_header]:pl-2.5 [&_header]:text-muted-foreground [&_header]:text-[12px] [&_header]:shrink-0 [&_header_strong]:font-medium [&_header_strong]:text-foreground [&_footer]:flex [&_footer]:justify-end [&_footer]:items-center [&_footer]:gap-1 [&_footer]:pt-1.5 [&_footer]:px-2 [&_footer]:pb-2 [&_footer]:shrink-0 [&_footer_kbd]:ml-1 [&_footer_kbd]:text-[10.5px] [&_footer_kbd]:text-inherit [&_footer_kbd]:opacity-65"
        aria-label="Agent questions"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header>
          <Icon name="question" size={14} />
          <strong>Questions</strong>
          {from ? <span className="min-w-0 truncate text-faint">{from}</span> : null}
          <span className="flex-1" />
          {questions.length > 1 ? (
            <nav
              className="flex items-center gap-px text-[11px] tabular-nums whitespace-nowrap"
              aria-label="Questions"
            >
              <button
                type="button"
                className="icon-button text-muted-foreground p-[5px] enabled:hover:text-foreground aria-expanded:text-foreground in-[.question-card]:size-[22px] in-[.question-card]:p-0"
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
                className="icon-button text-muted-foreground p-[5px] enabled:hover:text-foreground aria-expanded:text-foreground in-[.question-card]:size-[22px] in-[.question-card]:p-0"
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
            className="icon-button text-muted-foreground p-[5px] enabled:hover:text-foreground aria-expanded:text-foreground in-[.question-card]:size-[22px] in-[.question-card]:p-0"
            aria-label={collapsed ? 'Show questions' : 'Hide questions'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            <span
              className={`inline-flex text-muted-foreground transition-transform duration-[120ms] ease-[ease] [&.open]:rotate-90 motion-reduce:transition-none ${collapsed ? '' : 'open'}`}
            >
              <Icon name="chevron" size={12} />
            </span>
          </button>
        </header>
        {collapsed ? null : (
          <>
            <div className="overflow-y-auto px-1.5 pt-0 pb-0.5 min-h-0">
              <p
                className="flex gap-1.5 mt-0.5 mx-1 mb-2 text-[12.5px] font-medium leading-[1.45] [&_span]:text-faint [&_span]:font-[450] [&_span]:tabular-nums"
                id={promptId}
              >
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
                      className="question-option flex items-center justify-start gap-2 w-full min-h-7 py-[3px] pr-1.5 pl-1 rounded-md text-[12px] text-left text-foreground enabled:hover:bg-muted enabled:hover:outline-none focus-visible:bg-muted focus-visible:outline-none aria-checked:bg-accent [&>svg]:ml-auto [&>svg]:text-muted-foreground [&_kbd]:inline-flex [&_kbd]:items-center [&_kbd]:justify-center [&_kbd]:size-[18px] [&_kbd]:shrink-0 [&_kbd]:border [&_kbd]:border-subtle [&_kbd]:rounded-sm [&_kbd]:text-[10px] [&_kbd]:font-medium [&_kbd]:text-muted-foreground aria-checked:[&_kbd]:border-strong aria-checked:[&_kbd]:text-foreground [&.other]:cursor-text [&.other_input]:flex-1 [&.other_input]:min-w-0 [&.other_input]:text-[12px] [&.other_input:focus-visible]:outline-none"
                      onClick={() => pick(option)}
                    >
                      <kbd>{KEYS[slot]}</kbd>
                      <span className="min-w-0 flex flex-col gap-px wrap-anywhere [&_em]:ml-1.5 [&_em]:not-italic [&_em]:text-[10.5px] [&_em]:text-faint [&_small]:text-[11px] [&_small]:text-muted-foreground">
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
                <label className="question-option flex items-center justify-start gap-2 w-full min-h-7 py-[3px] pr-1.5 pl-1 rounded-md text-[12px] text-left text-foreground enabled:hover:bg-muted enabled:hover:outline-none focus-visible:bg-muted focus-visible:outline-none aria-checked:bg-accent [&>svg]:ml-auto [&>svg]:text-muted-foreground [&_kbd]:inline-flex [&_kbd]:items-center [&_kbd]:justify-center [&_kbd]:size-[18px] [&_kbd]:shrink-0 [&_kbd]:border [&_kbd]:border-subtle [&_kbd]:rounded-sm [&_kbd]:text-[10px] [&_kbd]:font-medium [&_kbd]:text-muted-foreground aria-checked:[&_kbd]:border-strong aria-checked:[&_kbd]:text-foreground [&.other]:cursor-text [&.other_input]:flex-1 [&.other_input]:min-w-0 [&.other_input]:text-[12px] [&.other_input:focus-visible]:outline-none other">
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
                className="min-h-6 px-2 py-0.5 text-[11.5px] text-muted-foreground"
                title="Skip these questions. The agent is told you declined."
                onClick={() => respond(false)}
              >
                Skip <kbd>Esc</kbd>
              </button>
              <button
                type="button"
                className="min-h-6 px-2 py-0.5 rounded-md text-[11.5px] bg-primary text-primary-foreground enabled:hover:bg-accent-hover disabled:bg-accent disabled:text-faint"
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
