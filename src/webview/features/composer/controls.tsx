import {
  AGENT_MODES,
  type AgentMode,
  agentTarget,
  CAPABILITIES,
  MODE_LABELS,
  nextThinking,
  profileLabel,
  THINKING_LABELS,
} from '../../../shared/model';
import { send } from '../../app/bridge';
import { AgentMark, Icon, type IconName } from '../../components/icons';
import { Hint, Menu } from '../../components/menus';
import { EffortMenu } from '../models/effort-menu';
import { ModelSelector } from '../models/model-selector';
import type { ComposerProps } from './types';
import type { useComposer } from './use-composer';

const MODE_ICONS: Record<AgentMode, IconName> = {
  ask: 'question',
  plan: 'plan',
  auto: 'autoMode',
};
export function ComposerControls({
  catalog,
  session,
  preferences,
  agent,
  model,
  effort,
  modeLocked,
  thinking,
  support,
  modeShown,
  efforts,
  target,
  focusInput,
  menuSide,
  selectModel,
  selectEffort,
  selectThinking,
  selectMode,
  guide,
}: Pick<ComposerProps, 'catalog' | 'session' | 'preferences'> &
  Pick<
    ReturnType<typeof useComposer>,
    | 'agent'
    | 'model'
    | 'effort'
    | 'modeLocked'
    | 'thinking'
    | 'support'
    | 'modeShown'
    | 'efforts'
    | 'target'
    | 'focusInput'
    | 'menuSide'
    | 'selectModel'
    | 'selectEffort'
    | 'selectThinking'
    | 'selectMode'
    | 'guide'
  >) {
  return (
    <>
      <Menu
        label={modeShown.label}
        side={menuSide}
        icon={<Icon name={modeShown.mode ? MODE_ICONS[modeShown.mode] : 'agentMode'} size={13} />}
        ariaLabel={`Mode: ${modeShown.label}`}
        title="⇧Tab to change mode"
        className="mode-chip text-muted-foreground in-data-[mode]:bg-mode-tint in-data-[mode]:text-mode in-data-[mode]:enabled:hover:bg-mode-tint in-data-[mode]:enabled:hover:text-mode in-data-[mode]:[&>span]:text-mode"
        disabled={modeLocked}
        onClosed={focusInput}
        items={AGENT_MODES.map((item) => ({
          key: item,
          label: MODE_LABELS[item],
          description: CAPABILITIES[agentTarget(agent).provider].modes[item],
          icon: (
            <span data-mode={item} className="inline-flex text-mode">
              <Icon name={MODE_ICONS[item]} size={14} />
            </span>
          ),
          selected: modeShown.mode === item,
          onSelect: () => selectMode(item),
        }))}
      />
      <ModelSelector
        catalog={catalog}
        agent={agent}
        model={model}
        active={session?.activeModel}
        lockedAgent={Boolean(session)}
        side={menuSide}
        onSelect={selectModel}
        onRetry={() => send({ type: 'refreshModels' })}
        onClosed={focusInput}
      />
      <EffortMenu
        effort={effort}
        efforts={efforts}
        disabled={modeLocked}
        side={menuSide}
        onEffort={selectEffort}
        onClosed={focusInput}
      />
      {target ? (
        <Hint
          label={`Runs ${profileLabel(target)} on its default model, in a card in this thread. ${profileLabel(agent)} isn't sent this message.`}
        >
          <span className="inline-flex items-center gap-1 min-h-6 px-1.5 rounded-md bg-muted text-[11.5px] text-foreground">
            <span aria-hidden="true">→</span>
            <AgentMark agent={target} size={12} />
            <span>{profileLabel(target)}</span>
          </span>
        </Hint>
      ) : null}
      {/* The wrapper keeps the reason reachable while the button is disabled. */}
      <Hint
        label={`Thinking: ${THINKING_LABELS[thinking]}.${support.reason ? ` ${support.reason}.` : ''}`}
      >
        <span className="inline-flex">
          <button
            type="button"
            className="icon-button p-[5px] text-faint enabled:hover:text-foreground aria-pressed:text-foreground aria-pressed:bg-muted disabled:pointer-events-none"
            aria-label="Thinking"
            aria-pressed={thinking === 'on'}
            disabled={modeLocked || (!support.on && !support.off)}
            onClick={() => selectThinking(nextThinking(thinking, support))}
          >
            <Icon name="brain" size={13} />
          </button>
        </span>
      </Hint>
      {guide ? (
        <Hint
          label={`${guide.label}: ${preferences[guide.key] ? 'on' : 'off'}. Applies to your next message.`}
        >
          <button
            type="button"
            className="icon-button p-[5px] text-faint enabled:hover:text-foreground aria-pressed:text-mode"
            aria-label={guide.label}
            aria-pressed={preferences[guide.key]}
            onClick={() =>
              send({
                type: 'setGuide',
                guide: guide.key,
                enabled: !preferences[guide.key],
              })
            }
          >
            <Icon name={guide.icon} size={13} />
          </button>
        </Hint>
      ) : null}
    </>
  );
}
