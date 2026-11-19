import { describe, expect, it } from 'vitest';
import { hexToHsv, hsvToHex, parseHex } from '../src/ui/colorMath';

describe('colour picker maths', () => {
  it('reads hex the way people type it', () => {
    expect(parseHex('#FF8800')).toBe('#ff8800');
    expect(parseHex('ff8800')).toBe('#ff8800');
    expect(parseHex('#f80')).toBe('#ff8800');
    expect(parseHex(' f80 ')).toBe('#ff8800');
    expect(parseHex('#ff880')).toBeNull();
    expect(parseHex('banana')).toBeNull();
  });

  it('goes to HSV and back without losing the colour', () => {
    for (const hex of ['#000000', '#ffffff', '#ff4d9d', '#5b3ee0', '#39ff88', '#808080', '#123456']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it('knows the main hues', () => {
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('#00ff00').h).toBe(120);
    expect(hexToHsv('#0000ff').h).toBe(240);
    expect(hsvToHex({ h: 60, s: 1, v: 1 })).toBe('#ffff00');
    expect(hsvToHex({ h: 200, s: 0, v: 0.5 })).toBe('#808080');
  });
});
