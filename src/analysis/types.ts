/**
 * Output of song analysis: what chart generation works from.
 */
export const ANALYSIS_VERSION = 6;
export const ANALYSIS_SAMPLE_RATE = 22050;

export type DrumKind = 'kick' | 'snare' | 'hat';

export interface DrumHit {
  t: number;
  kind: DrumKind;
  /** 0..1: the band's flux at the hit over its 99th-percentile frame in the song (clipped at 1). */
  strength: number;
}

export interface PitchedNote {
  t: number;
  dur: number;
  /** For chords: the top (melody) note. */
  midi: number;
  /** 0..1 */
  strength: number;
  /** Pitch-bend activity (vibrato, slides); singing voices have much more than synths or keys. */
  bend?: number;
  /** All sounding pitches when this note is a chord (ascending, includes `midi`). */
  chord?: number[];
  /** Fractional MIDI pitch (average including bends), when the transcriber provides it. */
  fine?: number;
}

export interface HarmonicEvent {
  t: number;
  /** Pitch class 0..11 of the detected chord root. */
  root: number;
  minor: boolean;
  /** 0..1, how strongly the harmony changed here. */
  strength: number;
}

export interface Section {
  start: number;
  end: number;
  /** 0..1 relative loudness/density of the section. */
  energy: number;
}

export interface AnalysisResult {
  version: number;
  source: 'local' | 'ml';
  duration: number;
  tempo: number;
  beats: number[];
  /** Indices into `beats` that start a bar. */
  downbeats: number[];
  drums: DrumHit[];
  bass: PitchedNote[];
  /** The main melodic/harmonic instrument (synth, keys, guitar), chords included. */
  lead: PitchedNote[];
  /** The sung melody. */
  vocals: PitchedNote[];
  harmony: HarmonicEvent[];
  sections: Section[];
  /** Normalized loudness curve sampled every `energyHop` seconds. */
  energy: number[];
  energyHop: number;
  key?: { tonic: number; minor: boolean };
  /** Which melodic transcriber produced bass/lead notes. */
  pitchSource: 'basic-pitch' | 'salience' | 'ml';
}

/** The stems a song is separated into before it is charted. */
export type StemName = 'drums' | 'bass' | 'vocals' | 'other';
export const STEM_NAMES: StemName[] = ['drums', 'bass', 'vocals', 'other'];

/** Raw transcription of each separated stem (before any line extraction). */
export interface StemNotes {
  bass: PitchedNote[];
  vocals: PitchedNote[];
  other: PitchedNote[];
}

/** Instrument lines handed to the pipeline instead of having it find them itself. */
export interface PartLines {
  bass: PitchedNote[];
  lead: PitchedNote[];
  vocals: PitchedNote[];
}

export type AnalysisStep = 'decoding' | 'spectrum' | 'separating' | 'rhythm' | 'harmony' | 'melody' | 'finishing';

export interface AnalysisProgress {
  step: AnalysisStep;
  /** 0..1 overall progress */
  progress: number;
}

/** Light runtime validation for results that come from storage. */
export function isAnalysisResult(x: unknown): x is AnalysisResult {
  const a = x as AnalysisResult;
  return (
    !!a &&
    typeof a === 'object' &&
    typeof a.duration === 'number' &&
    Array.isArray(a.beats) &&
    Array.isArray(a.downbeats) &&
    Array.isArray(a.drums) &&
    Array.isArray(a.bass) &&
    Array.isArray(a.lead) &&
    Array.isArray(a.vocals) &&
    Array.isArray(a.harmony) &&
    Array.isArray(a.sections) &&
    a.beats.every((b) => typeof b === 'number' && Number.isFinite(b))
  );
}
