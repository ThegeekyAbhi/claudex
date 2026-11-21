import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../../components/icons';

export function Banner({
  icon,
  children,
  actions,
}: {
  icon: IconName;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-subtle bg-surface px-3 py-2 text-[12.5px] text-muted-foreground">
      <Icon name={icon} size={14} />
      <span className="min-w-0 flex-1">{children}</span>
      <span className="flex items-center gap-1">{actions}</span>
    </div>
  );
}
