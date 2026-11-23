/**
 * Times the steps of one piece of the analysis, for a line in the console: where a song's minute
 * goes differs a lot between a graphics card, a processor and the app, and is only known by measuring.
 */
export class Stopwatch {
  private readonly started = performance.now();
  private last = this.started;
  private readonly laps: [string, number][] = [];

  /** Ends the step that ran since the last lap (or since the start) under `label`. */
  lap(label: string) {
    const now = performance.now();
    this.laps.push([label, now - this.last]);
    this.last = now;
  }

  /** Milliseconds since the start. */
  total(): number {
    return performance.now() - this.started;
  }

  toString(): string {
    return [`${seconds(this.total())} in all`, ...this.laps.map(([label, ms]) => `${label} ${seconds(ms)}`)].join(', ');
  }
}

/** Milliseconds as seconds to two places: "1.23 s". */
export const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
