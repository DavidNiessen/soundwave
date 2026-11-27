import { describe, expect, it } from 'vitest';
import { coarseEnergy, likeness, nameKey, type Fingerprint } from '../src/net/similarity';

/** A song's loudness every 0.1 s: verses and choruses, the same every run for a seed. */
function loudness(seconds: number, seed: number): number[] {
  let x = seed;
  return Array.from({ length: seconds * 10 }, (_, i) => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const section = Math.floor(i / (150 + seed * 7)) % 2 ? 0.8 : 0.4;
    return section + 0.15 * Math.sin(i / (3 + seed)) + (x / 0x7fffffff) * 0.1;
  });
}
const print = (energy: number[], duration: number, title = 'Song', artist = 'Band'): Fingerprint => ({
  energy: coarseEnergy(energy, 0.1),
  duration,
  title: nameKey(title),
  artist: nameKey(artist),
});

describe('telling songs apart', () => {
  const song = loudness(200, 3);
  it('finds the same recording in another file: quieter, a moment later, a name a little different', () => {
    const other = [0, 0, 0, 0, 0, 0, ...song.map((v) => v * 0.7 + 0.01)].slice(0, song.length);
    expect(likeness(print(song, 200), print(other, 200.6, 'Song (Remastered 2011)'))?.kind).toBe('same');
  });
  it('does not take another song of the same length for it', () => {
    expect(likeness(print(song, 200), print(loudness(200, 11), 200, 'Other', 'Others'))).toBeNull();
  });
  it('flags the same name and length as likely, and lengths far apart as nothing', () => {
    expect(likeness(print([], 200, 'Song', 'Band'), print([], 202, 'song!', 'BAND'))?.kind).toBe('likely');
    expect(likeness(print(song, 200), print(song, 240))).toBeNull();
  });
  it('compares names without what is in brackets, after a dash, or featured', () => {
    expect(nameKey('Song (Live) [2020]')).toBe('song');
    expect(nameKey('Song - Radio Edit')).toBe('song');
    expect(nameKey('Band feat. Someone')).toBe('band');
    expect(nameKey('Café')).toBe('cafe');
  });
});
