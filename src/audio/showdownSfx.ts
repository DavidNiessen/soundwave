/**
 * A Showdown's sounds, made live in Web Audio rather than played from files: a Strike flying off,
 * the warning that one is coming, the hit landing, the round's countdown, and going through, out
 * or winning. They go through the effects' output (audio/sfx.ts), so they follow its volume.
 */
import { sfxOutput } from './sfx';

export type ShowdownSfx = 'strike' | 'incoming' | 'impact' | 'tick' | 'through' | 'out' | 'win' | 'turn';

/** A burst of noise, for whooshes and impacts. */
function noise(ctx: AudioContext, seconds: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** One tone with an attack and a decay. */
function tone(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  freq: number,
  dur: number,
  opts: { type?: OscillatorType; gain?: number; to?: number } = {},
) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = opts.type ?? 'triangle';
  o.frequency.setValueAtTime(freq, t);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(opts.gain ?? 0.3, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
  o.onended = () => g.disconnect();
}

/** Filtered noise sweeping from one frequency to another: a whoosh, or with a low end, a thud. */
function sweep(ctx: AudioContext, out: AudioNode, t: number, dur: number, from: number, to: number, gain: number, q = 1.2) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx, dur);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.onended = () => g.disconnect();
}

export function playShowdownSfx(name: ShowdownSfx) {
  const g = sfxOutput();
  if (!g) return;
  const { ctx, out } = g;
  const t = ctx.currentTime + 0.005;
  switch (name) {
    case 'strike':
      // A rising whoosh with a bright zap on top: the Strike leaves.
      sweep(ctx, out, t, 0.45, 300, 4200, 0.5);
      tone(ctx, out, t, 220, 0.35, { type: 'sawtooth', gain: 0.12, to: 1400 });
      break;
    case 'incoming':
      // Two short alarm notes.
      tone(ctx, out, t, 988, 0.12, { type: 'square', gain: 0.1 });
      tone(ctx, out, t + 0.16, 740, 0.16, { type: 'square', gain: 0.1 });
      break;
    case 'impact':
      // A low thud under a burst of noise, then a falling shimmer.
      tone(ctx, out, t, 140, 0.35, { type: 'sine', gain: 0.55, to: 45 });
      sweep(ctx, out, t, 0.5, 2600, 220, 0.45, 0.7);
      tone(ctx, out, t + 0.05, 1320, 0.6, { type: 'triangle', gain: 0.06, to: 330 });
      break;
    case 'tick':
      tone(ctx, out, t, 1046, 0.08, { type: 'sine', gain: 0.18 });
      break;
    case 'turn':
      sweep(ctx, out, t, 0.25, 800, 2400, 0.18, 2);
      break;
    case 'through':
      // Up a major arpeggio.
      [523, 659, 784, 1046].forEach((f, i) => tone(ctx, out, t + i * 0.08, f, 0.45, { gain: 0.16 }));
      break;
    case 'out':
      // Down, minor.
      [494, 392, 311].forEach((f, i) => tone(ctx, out, t + i * 0.14, f, 0.5, { type: 'sine', gain: 0.18 }));
      break;
    case 'win':
      // A held major chord with a rising top note.
      [523, 659, 784].forEach((f) => tone(ctx, out, t, f, 1.4, { gain: 0.12 }));
      [784, 1046, 1318].forEach((f, i) => tone(ctx, out, t + 0.15 + i * 0.12, f, 0.9, { gain: 0.1 }));
      sweep(ctx, out, t, 1.2, 1200, 6000, 0.08, 0.5);
      break;
  }
}
