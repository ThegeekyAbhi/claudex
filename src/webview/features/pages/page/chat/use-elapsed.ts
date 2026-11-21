import { useEffect, useState } from 'react';

/** Seconds since `from`, ticking while a turn runs. */
export function useElapsed(from: number | undefined): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!from) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [from]);
  return from ? Math.max(0, Math.round((now - from) / 1000)) : 0;
}
