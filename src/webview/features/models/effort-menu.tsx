import { Icon } from '../../components/icons';
import { Menu } from '../../components/menus';
import { effortLabel } from './model-selector';

/** Reasoning effort, for the levels the chosen model supports. */
export function EffortMenu({
  effort,
  efforts,
  disabled,
  side,
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
    <Menu
      label={label}
      icon={<Icon name="gauge" size={13} />}
      ariaLabel={`Effort: ${label}`}
      disabled={disabled}
      side={side}
      onClosed={onClosed}
      heading="Reasoning effort"
      items={[
        {
          key: 'default',
          label: 'Model default',
          selected: !effort,
          onSelect: () => onEffort(undefined),
        },
        ...efforts.map((level) => ({
          key: level,
          label: effortLabel(level),
          selected: level === effort,
          onSelect: () => onEffort(level),
        })),
      ]}
    />
  );
}
