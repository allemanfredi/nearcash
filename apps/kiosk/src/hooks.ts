import { useEffect, useRef, useState } from 'react';

/**
 * Calls `onIdle` after `ms` without a touch, while `active`. A customer who
 * walks away mid-way must not leave their choices on the screen.
 */
export function useIdleTimeout(ms: number, active: boolean, onIdle: () => void): void {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;
  useEffect(() => {
    if (!active) return;
    let timer = window.setTimeout(() => onIdleRef.current(), ms);
    const restart = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => onIdleRef.current(), ms);
    };
    window.addEventListener('pointerdown', restart);
    window.addEventListener('keydown', restart);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', restart);
      window.removeEventListener('keydown', restart);
    };
  }, [ms, active]);
}

/** Seconds left until `deadline` (ISO time), updated every second; never negative. */
export function useSecondsLeft(deadline: string): number {
  const compute = () => Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 1000));
  const [seconds, setSeconds] = useState(compute);
  // `compute` only depends on `deadline`, so the effect restarts when it changes.
  useEffect(() => {
    setSeconds(compute());
    const timer = window.setInterval(() => setSeconds(compute()), 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return seconds;
}

/** "mm:ss" */
export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/** An address shortened to its first and last characters, e.g. "0x5aAe…eAed", for a sentence. */
export function shortAddress(address: string): string {
  return address.length <= 14 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}
