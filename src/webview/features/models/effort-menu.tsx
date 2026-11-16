import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Icon } from '../../components/icons';
import { effortLabel } from './model-selector';

/** Reasoning effort, for the levels the chosen model supports, as a snapping slider. */
export function EffortMenu({
  effort,
  efforts,
  disabled,
  side = 'top',
  onEffort,
  onClosed,
}: {
  effort?: string;
  efforts: string[];
  disabled?: boolean;
  side?: 'top' | 'bottom';
  onEffort: (effort?: string) => void;
  onClosed?: () => void;
}) {
  if (!efforts.length) return null;
  const label = effort ? effortLabel(effort) : 'Default';
  return (
    <Popover modal={false}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className="chip gap-[5px] min-h-6 px-1.5 py-[3px] text-[11.5px] text-muted-foreground whitespace-nowrap enabled:hover:text-foreground enabled:hover:bg-muted aria-expanded:text-foreground aria-expanded:bg-muted max-[480px]:in-[.composer-controls]:min-w-0 max-[480px]:in-[.composer-controls]:shrink"
          aria-label={`Effort: ${label}`}
        >
          <Icon name="gauge" size={13} />
          <span className="text-foreground max-[480px]:min-w-0 max-[480px]:overflow-hidden max-[480px]:text-ellipsis">
            {label}
          </span>
          <Icon name="chevronDown" size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 bg-transparent border-0 shadow-none text-foreground z-40 animate-menu-in motion-reduce:animate-none focus:outline-none"
        side={side}
        align="start"
        sideOffset={6}
        collisionPadding={8}
        onOpenAutoFocus={(event) => {
          // Land on the slider so arrow keys work straight away.
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)
            ?.querySelector<HTMLElement>('[role="slider"]')
            ?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!onClosed) return;
          event.preventDefault();
          onClosed();
        }}
      >
        <EffortSlider effort={effort} efforts={efforts} onEffort={onEffort} />
      </PopoverContent>
    </Popover>
  );
}

/** Stop 0 is the model's default; the rest are its levels, lowest first. */
function EffortSlider({
  effort,
  efforts,
  onEffort,
}: {
  effort?: string;
  efforts: string[];
  onEffort: (effort?: string) => void;
}) {
  const stops: (string | undefined)[] = [undefined, ...efforts];
  const last = stops.length - 1;
  const index = Math.max(0, stops.indexOf(effort));
  const track = useRef<HTMLDivElement>(null);
  /** The unsnapped position, 0–1, while a drag is under way. */
  const [drag, setDrag] = useState<number | null>(null);

  const ratioAt = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect?.width) return index / last;
    // The thumb's centre travels between the inner edges, so the ends are reachable.
    const inset = THUMB / 2 + PAD;
    return clamp((clientX - rect.left - inset) / (rect.width - inset * 2), 0, 1);
  };
  const pick = (next: number) => {
    const stop = clamp(next, 0, last);
    if (stop !== index) onEffort(stops[stop]);
  };
  const shown = drag ?? index / last;
  const nearest = drag === null ? index : Math.round(drag * last);
  const current = stops[nearest];
  const text = current ? effortLabel(current) : 'Default';

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    setDrag(ratioAt(event.clientX));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    setDrag(ratioAt(event.clientX));
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const ratio = ratioAt(event.clientX);
    setDrag(null);
    pick(Math.round(ratio * last));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
    };
    if (event.key in step) pick(index + step[event.key]);
    else if (event.key === 'Home') pick(0);
    else if (event.key === 'End') pick(last);
    else return;
    event.preventDefault();
  };

  const position = `calc(${PAD + THUMB / 2}px + (100% - ${(PAD + THUMB / 2) * 2}px) * ${shown})`;
  const still = drag !== null || reducedMotion();
  const easing = 'cubic-bezier(0.34, 1.4, 0.64, 1)';
  const duration = still ? '0ms' : '260ms';

  return (
    // The slider is its own surface: a pill with the level read out at its right end.
    <div className="flex items-center h-8 rounded-full overflow-hidden bg-overlay border border-strong shadow-[0_6px_20px_rgb(0_0_0/0.28)] select-none">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Reasoning effort"
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={index}
        aria-valuetext={effort ? effortLabel(effort) : 'Model default'}
        className="relative self-stretch w-[164px] rounded-full cursor-grab active:cursor-grabbing touch-none outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/20"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onKeyDown={onKeyDown}
      >
        {/* The filled part, a soft wash up to the thumb. */}
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,#2f5fd0,#4a86f2)] shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]"
          style={{
            width: `calc(${position} + ${THUMB / 2 + PAD}px)`,
            transition: `width ${duration} ${easing}`,
          }}
        />
        {stops.map((stop, at) => (
          <span
            key={stop ?? 'default'}
            aria-hidden="true"
            className="absolute top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 rounded-full transition-[opacity,background-color] duration-200"
            style={{
              backgroundColor: at < nearest ? '#fff' : 'var(--foreground)',
              left: `calc(${PAD + THUMB / 2}px + (100% - ${(PAD + THUMB / 2) * 2}px) * ${at / last})`,
              opacity: at === nearest ? 0 : at < nearest ? 0.5 : 0.18,
            }}
          />
        ))}
        <div
          aria-hidden="true"
          className="absolute top-1/2 h-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgb(0_0_0/0.4)]"
          style={{
            width: drag === null ? THUMB : THUMB + 4,
            left: position,
            transition: `left ${duration} ${easing}, width ${still ? '0ms' : '150ms'} ease`,
          }}
        />
      </div>
      <span
        key={text}
        aria-hidden="true"
        className="min-w-[72px] pl-2.5 pr-3.5 text-[12px] font-medium text-foreground animate-effort-label motion-reduce:animate-none"
      >
        {text}
      </span>
    </div>
  );
}

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
const THUMB = 11;
const PAD = 6;
function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
