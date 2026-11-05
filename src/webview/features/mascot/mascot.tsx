import type { MascotActivity } from './activity';

/** Asset URLs resolve beside the compiled stylesheet, inside the permitted dist root. */
export function Mascot({ activity = 'attentive' }: { activity?: MascotActivity }) {
  return (
    <span aria-hidden="true" className={`mascot mascot-${activity}`} data-activity={activity} />
  );
}
