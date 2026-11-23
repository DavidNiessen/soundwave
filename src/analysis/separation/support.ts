import { invoke } from '@tauri-apps/api/core';

/**
 * What this device runs the analysis models on: its graphics card (seconds per song) or its
 * processor (minutes per song) in the browser, or the desktop app itself (`native`, see
 * analysis/native.ts). Every device is let try, phones and tablets too, though separating a song
 * takes about 2.5 GB while it runs and a phone's browser may not give a page that much. (`none`
 * is left for the development switch below.)
 */
export type AnalysisDevice = 'gpu' | 'cpu' | 'native' | 'none';

/** Whether the page runs in WebKit: Safari, every browser on iPhone and iPad, and the macOS and Linux apps. */
export function onWebKit(): boolean {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/Chrome\/|Chromium|Edg\//.test(ua);
}

/**
 * Whether the desktop app runs the models itself, and should: in WebKit (whose WebGPU holds
 * gigabytes for every song until the page is closed, and whose browser runtime gets no threads in
 * the app), and wherever the webview would fall back to the processor.
 */
async function appRunsModels(webviewDevice: 'gpu' | 'cpu'): Promise<boolean> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return false;
  if (!onWebKit() && webviewDevice === 'gpu') return false;
  try {
    return await invoke<boolean>('models_available');
  } catch {
    return false;
  }
}

let cached: Promise<AnalysisDevice> | null = null;

async function detect(): Promise<AnalysisDevice> {
  // Development only: `localStorage['soundwave.dev.analysis-device'] = 'cpu'` (or 'none') to try the other paths.
  if (import.meta.env.DEV) {
    try {
      const forced = localStorage.getItem('soundwave.dev.analysis-device');
      if (forced === 'gpu' || forced === 'cpu' || forced === 'native' || forced === 'none') return forced;
    } catch {
      /* storage unavailable */
    }
  }
  const nav = navigator as Navigator & {
    gpu?: { requestAdapter(): Promise<{ isFallbackAdapter?: boolean; info?: { isFallbackAdapter?: boolean } } | null> };
  };
  let webview: 'gpu' | 'cpu' = 'cpu';
  try {
    // A software stand-in for a graphics card would be far slower than the processor path.
    const adapter = await nav.gpu?.requestAdapter();
    if (adapter && !(adapter.isFallbackAdapter ?? adapter.info?.isFallbackAdapter)) webview = 'gpu';
  } catch {
    /* no adapter */
  }
  return (await appRunsModels(webview)) ? 'native' : webview;
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
