import { useEffect } from 'react';

type WakeLockSentinelLike = { release: () => Promise<void> };

/** Keeps the screen awake while `active` is true (no-op where unsupported). */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const request = async () => {
      try {
        const lock = await nav.wakeLock!.request('screen');
        if (cancelled) { void lock.release(); return; }
        sentinel = lock;
      } catch {
        /* denied or unsupported */
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void request();
    };

    void request();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
