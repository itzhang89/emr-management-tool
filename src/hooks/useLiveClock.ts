import { useEffect, useState } from "react";

/**
 * Re-renders roughly once a second while `active`, returning the current epoch
 * millisecond — enough to drive a live "how long has this been running" clock.
 *
 * Returns `null` when inactive so callers do not have to guard the interval
 * themselves. The interval is torn down as soon as the turn/step stops or the
 * component unmounts, so a clock never outlives what it is timing.
 */
export function useLiveClock(active: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [active]);

  return active ? now : null;
}

/** A readable count-up, e.g. "0:04", "3:12", "1:02:07". */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${Number(mm)}:${ss}`;
}
