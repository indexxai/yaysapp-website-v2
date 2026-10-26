'use client';
import { useEffect, useState } from 'react';
/** Seconds left until `until` (ms timestamp), ticking every second. */
export function useCountdown(until: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (until <= Date.now()) return; const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}
