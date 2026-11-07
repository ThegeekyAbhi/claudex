import type { MascotActivity } from './activity';

/** Asset URLs resolve beside the compiled stylesheet, inside the permitted dist root. */
export function Mascot({
  activity = 'attentive',
  size,
}: {
  activity?: MascotActivity;
  /** Pixel size; the sprite is 32px by default. */
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={`mascot mascot-${activity}`}
      data-activity={activity}
      style={size ? { width: size, height: size } : undefined}
    />
  );
}
