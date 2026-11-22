/**
 * Colour as the colour picker works with it: hue (0..360), saturation and value (0..1), and `#rrggbb`.
 * HSV keeps the hue when a colour turns grey or black, so the picker does not jump about.
 */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/** A hex colour from what the player typed (`#abc`, `abc`, `#aabbcc` or `aabbcc`), or null. */
export function parseHex(text: string): string | null {
  const t = text.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(t)) return `#${t[0]}${t[0]}${t[1]}${t[1]}${t[2]}${t[2]}`;
  if (/^[0-9a-f]{6}$/.test(t)) return `#${t}`;
  return null;
}

export function hexToHsv(hex: string): Hsv {
  const n = parseInt((parseHex(hex) ?? '#000000').slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (k: number) => {
    const x = (k + h / 60) % 6;
    const c = v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

/** The hue at full colour, for the picker's field. */
export const hueHex = (h: number) => hsvToHex({ h, s: 1, v: 1 });
