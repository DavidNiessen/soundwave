/**
 * Analyzing waits while the player plays a song, edits one or makes a video of a run: the stem
 * model would otherwise share the graphics card and the processor with the highway, the stage and
 * the audio, and cost the player frames. A song under way pauses between two of its segments and
 * goes on from there when the hold ends; the next song starts only then.
 */
export class AnalysisHold {
  private reason: string | null = null;
  private waiting: (() => void)[] = [];
  private listeners = new Set<(reason: string | null) => void>();

  /** What analyzing waits for, said to the player ("Paused while you play"); null when it does not wait. */
  get held(): string | null {
    return this.reason;
  }

  set(reason: string | null) {
    if (reason === this.reason) return;
    this.reason = reason;
    for (const l of this.listeners) l(reason);
    if (!reason) for (const w of this.waiting.splice(0)) w();
  }

  /** Resolves once analyzing may go on. */
  free(): Promise<void> {
    return this.reason ? new Promise((resolve) => this.waiting.push(resolve)) : Promise.resolve();
  }

  /** Calls `l` whenever the hold changes; returns the function that stops that. */
  watch(l: (reason: string | null) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const analysisHold = new AnalysisHold();
