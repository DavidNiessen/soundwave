/**
 * A run as it travels to and from a server: its operations and their song times in base64 (see
 * ScoreSubmission in protocol.ts), and the chart id a board is keyed by.
 */
import type { Chart } from '../chart/types';
import type { ReplayInputs } from '../game/replay';
import { chartKey } from './protocol';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeRun(inputs: ReplayInputs): { ops: string; times: string } {
  const times = new Uint8Array(inputs.times.length * 4);
  const view = new DataView(times.buffer);
  inputs.times.forEach((t, i) => view.setFloat32(i * 4, t, true));
  return { ops: toBase64(inputs.ops), times: toBase64(times) };
}

export function decodeRun(ops: string, times: string): ReplayInputs {
  const o = fromBase64(ops);
  const tb = fromBase64(times);
  const view = new DataView(tb.buffer);
  const t = new Float32Array(Math.min(o.length, tb.length >> 2));
  for (let i = 0; i < t.length; i++) t[i] = view.getFloat32(i * 4, true);
  return { ops: o.subarray(0, t.length), times: t };
}

/** The chart's id on a server's boards: SHA-256 of its lanes and notes. */
export async function chartId(chart: Chart): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(chartKey(chart)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
