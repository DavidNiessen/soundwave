/**
 * What this device runs the stem model on: its graphics card (seconds per song) or its processor
 * (minutes per song). Every device is let try, phones and tablets too, though separating a song
 * takes about 2.5 GB while it runs and a phone's browser may not give a page that much. (`none`
 * is left for the development switch below.)
 */
export type AnalysisDevice = 'gpu' | 'cpu' | 'none';

let cached: Promise<AnalysisDevice> | null = null;

async function detect(): Promise<AnalysisDevice> {
  // Development only: `localStorage['soundwave.dev.analysis-device'] = 'cpu'` (or 'none') to try the other paths.
  if (import.meta.env.DEV) {
    try {
      const forced = localStorage.getItem('soundwave.dev.analysis-device');
      if (forced === 'gpu' || forced === 'cpu' || forced === 'none') return forced;
    } catch {
      /* storage unavailable */
    }
  }
  const nav = navigator as Navigator & {
    gpu?: { requestAdapter(): Promise<{ isFallbackAdapter?: boolean; info?: { isFallbackAdapter?: boolean } } | null> };
  };
  try {
    // A software stand-in for a graphics card would be far slower than the processor path.
    const adapter = await nav.gpu?.requestAdapter();
    if (adapter && !(adapter.isFallbackAdapter ?? adapter.info?.isFallbackAdapter)) return 'gpu';
  } catch {
    /* no adapter */
  }
  return 'cpu';
}

/**
 * A phone or tablet. They analyze too, but fetch the stem model (90 MB) only when the first song
 * is analyzed rather than as soon as the game opens, which may be over mobile data.
 */
export function isHandheld(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return nav.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod/i.test(nav.userAgent);
}

export function analysisDevice(): Promise<AnalysisDevice> {
  cached ??= detect();
  return cached;
}
