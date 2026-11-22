/**
 * What the music and the run do from frame to frame, apart from drawing: the beats as they pass,
 * the swell of light each one gives the highway, how loud the music is, what the stage is told, and
 * the word on the tag for each note. A song on screen and a replay's video made in a worker both
 * move by this, so the video moves as the game does.
 */
import { BandMeter, type BandLevels } from '../audio/bands';
import type { Chart } from '../chart/types';
import { barAt, barIntensity } from '../render/stage/LightShow';
import type { StageInput } from '../render/stage/protocol';
import type { GameEvent } from './GameSession';

export type Beat = 'none' | 'beat' | 'downbeat';

export interface ShowFrame {
  /** A beat passed since the last frame (a downbeat outranks a beat). */
  beat: Beat;
  /** How much the highway's light swells, 0..1: the latest beat and the bass. */
  pulse: number;
  bands: BandLevels;
  /** What the stage is told (null when there is no stage). */
  stage: StageInput | null;
}

export class ShowPulse {
  /** How loud the music is: from the engine's analyser, or from a song's samples (see BufferAnalyser). */
  readonly meter = new BandMeter();
  /** Song times of the bars. */
  readonly barTimes: number[];
  private readonly barLevels: number[];
  private readonly downbeats: Set<number>;
  private lastBeat = -1;
  /** When the latest beat landed, on the frame clock (ms). */
  private beatAt = Number.NEGATIVE_INFINITY;
  private meterAt: number;

  constructor(
    private readonly chart: Chart,
    clock = performance.now(),
  ) {
    this.downbeats = new Set(chart.downbeats);
    this.barTimes = chart.downbeats.map((i) => chart.beats[i]).filter((x) => x !== undefined);
    this.barLevels = barIntensity(chart);
    this.meterAt = clock;
  }

  /** Counts beats on from song time `t`, without a swell for those before it (a start, or a jump). */
  from(t: number) {
    const beats = this.chart.beats;
    this.lastBeat = -1;
    while (this.lastBeat + 1 < beats.length && beats[this.lastBeat + 1] <= t) this.lastBeat++;
  }

  /** Starts the frame clock afresh at `clock` (ms): a video's own clock, say. */
  restartClock(clock: number) {
    this.meterAt = clock;
    this.beatAt = Number.NEGATIVE_INFINITY;
  }

  /** The frame of song time `t` on the frame clock `now` (ms). */
  frame(t: number, now: number, overdrive: boolean, withStage: boolean): ShowFrame {
    const beats = this.chart.beats;
    let beat: Beat = 'none';
    while (this.lastBeat + 1 < beats.length && beats[this.lastBeat + 1] <= t) {
      this.lastBeat++;
      this.beatAt = now;
      beat = this.downbeats.has(this.lastBeat) ? 'downbeat' : 'beat';
    }
    // Each beat swells the highway's light in quickly and lets it ebb away softly: a rise of a few
    // hundredths of a second and a long fall, on the clock, so it is the same at any frame rate and
    // dies away during a pause. The curve peaks at 1, about 0.05 s after the beat.
    const since = (now - this.beatAt) / 1000;
    const beatPulse = since >= 0 && since < 1.5 ? ((1 - Math.exp(-since / 0.02)) * Math.exp(-since / 0.2)) / 0.715 : 0;
    const bands = this.meter.update(Math.min(0.1, Math.max(0, now - this.meterAt) / 1000));
    this.meterAt = now;
    const low = bands.low;
    let stage: StageInput | null = null;
    if (withStage) {
      const bar = barAt(this.barTimes, t);
      const busy = bar >= 0 ? (this.barLevels[bar] ?? 0.3) : 0.15;
      stage = { intensity: busy * 0.75 + low * 0.25, overdrive, barSeconds: this.chart.secondsPerBeat * 4, bands };
    }
    return { beat, pulse: beatPulse * 0.5 + low * 0.5, bands, stage };
  }
}

/**
 * The word on the tag beside the strike line for what just happened, its kind (its colour), and
 * for a hit or a release how far off it was (seconds, negative = early). Null: nothing to show.
 */
export function feedbackFor(e: GameEvent): { text: string; kind: string; delta?: number } | null {
  switch (e.type) {
    case 'hit':
    case 'release':
      return { text: e.grade.toUpperCase(), kind: e.grade, delta: e.delta };
    case 'miss':
      return { text: 'MISS', kind: 'miss' };
    case 'release-miss':
      return { text: e.early ? 'TOO EARLY' : 'LET GO!', kind: 'miss' };
    case 'phrase-complete':
      return { text: 'CHARGED', kind: 'od' };
    default:
      return null;
  }
}
