/**
 * The HUD of a replay's video, drawn onto the video's canvas: the page's own HUD is made of
 * elements, which a recording of a canvas cannot take. It follows that HUD's look: the song and its
 * timeline, the stars and the score at the lower left, the multiplier dial with the overdrive meter
 * on the deck, and the tag that says how each note went, with the streak above it.
 */

export interface VideoHudFrame {
  /** Song time and length, seconds. */
  t: number;
  duration: number;
  title: string;
  artist: string;
  /** "Lead score". */
  scoreLabel: string;
  score: number;
  /** The multiplier shown (overdrive doubles it), and the streak's own step (1..6) for its colour. */
  multiplier: number;
  level: number;
  /** How far the streak is toward the next step, 0..1 (1 at the top step). */
  streakP: number;
  streak: number;
  /** The overdrive meter, 0..1, and whether overdrive is on. */
  overdrive: number;
  overdriveActive: boolean;
  /** Stars earned (6: gold), and how far toward the next. */
  stars: number;
  starP: number;
  /** How the last note went, and how long ago, seconds. */
  feedback: { text: string; kind: string; age: number } | null;
  /** Where the highway stands, in the video's pixels: the middle of its strike line, its foot, its width. */
  deck: { x: number; y: number; foot: number; width: number } | null;
}

const FONT = '"Archivo Variable", Archivo, system-ui, sans-serif';
const DIAL: Record<number, string> = { 1: '#d2c9fa', 2: '#3a8bff', 3: '#3ddc5a', 4: '#ffd23d', 5: '#ff8a1f', 6: '#ffd23d' };
const TAG: Record<string, [string, string, string]> = {
  perfect: ['#ffe489', '#ff7d3d', '#3a1500'],
  great: ['#a6f9ea', '#3ab8ff', '#05283a'],
  good: ['#cbbcff', '#6a4cf0', '#ffffff'],
  miss: ['#ff97a6', '#bb2447', '#ffffff'],
  od: ['#e2f5ff', '#bfe6ff', '#06203a'],
};
const PANEL = 'rgba(6, 4, 14, 0.62)';
const EDGE = 'rgba(255, 255, 255, 0.11)';
const STAR = '#c4a6ff';
const GOLD = '#ffd23d';
const OD = '#bfe6ff';

const clock = (s: number) => {
  const n = Math.max(0, Math.ceil(s));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

function font(ctx: CanvasRenderingContext2D, px: number, weight = 900, italic = true, wide = true) {
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${Math.round(px)}px ${FONT}`;
  // The game's display face is the wide cut of Archivo.
  const c = ctx as CanvasRenderingContext2D & { fontStretch?: string };
  if ('fontStretch' in c) c.fontStretch = wide ? 'expanded' : 'normal';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = PANEL;
  ctx.fill();
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = Math.max(1, r / 10);
  ctx.stroke();
}

/** A five-pointed star centred on (x, y). */
function starPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Draws the HUD for one frame onto a canvas of `width` by `height` pixels. */
export function drawVideoHud(ctx: CanvasRenderingContext2D, width: number, height: number, f: VideoHudFrame) {
  const u = Math.min(width, height) / 1080;
  const portrait = height > width;
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // The score box: at the lower left, or across the top of an upright video (its foot is the deck's).
  const boxW = portrait ? width - 64 * u : 400 * u;
  const left = portrait ? 32 * u : 0.016 * width;
  const songH = 88 * u;
  const starsH = 52 * u;
  const scoreH = 70 * u;
  const gap = 12 * u;
  const total = songH + starsH + scoreH + gap * 2;
  const top = portrait ? 36 * u : height * 0.965 - total;

  // The song and how far through it is.
  panel(ctx, left, top, boxW, songH, 14 * u);
  font(ctx, 17 * u, 700, false, false);
  ctx.fillStyle = '#d2c9fa';
  ctx.fillText(fitText(ctx, f.artist, boxW - 40 * u), left + 18 * u, top + 26 * u);
  font(ctx, 24 * u, 800, false, false);
  ctx.fillStyle = '#f6f3ff';
  ctx.fillText(fitText(ctx, f.title, boxW - 40 * u), left + 18 * u, top + 52 * u);
  const barX = left + 18 * u;
  const barW = boxW - 110 * u;
  const barY = top + 68 * u;
  const p = f.duration > 0 ? Math.max(0, Math.min(1, f.t / f.duration)) : 0;
  roundRect(ctx, barX, barY, barW, 6 * u, 3 * u);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.fill();
  if (p > 0) {
    roundRect(ctx, barX, barY, barW * p, 6 * u, 3 * u);
    const g = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    g.addColorStop(0, '#b3306f');
    g.addColorStop(1, '#ff4d9d');
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.fillStyle = '#f6f3ff';
  ctx.fillRect(barX + barW * p - 1.5 * u, barY - 4 * u, 3 * u, 14 * u);
  font(ctx, 17 * u, 800);
  ctx.fillStyle = '#d2c9fa';
  ctx.textAlign = 'right';
  ctx.fillText(`-${clock(f.duration - f.t)}`, left + boxW - 16 * u, barY + 8 * u);
  ctx.textAlign = 'left';

  // The five stars: earned ones lit, the next one filling, all gold beyond five.
  const starY = top + songH + gap + starsH / 2;
  const gold = f.stars >= 6;
  for (let i = 0; i < 5; i++) {
    const cx = left + 24 * u + i * 50 * u;
    const lit = gold || i < f.stars;
    ctx.beginPath();
    ctx.arc(cx, starY, 22 * u, 0, Math.PI * 2);
    ctx.fillStyle = lit ? (gold ? '#c85c00' : '#221f30') : 'rgba(6, 4, 14, 0.6)';
    ctx.fill();
    if (!gold && i === f.stars && f.starP > 0) {
      ctx.beginPath();
      ctx.arc(cx, starY, 20 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f.starP);
      ctx.strokeStyle = STAR;
      ctx.lineWidth = 3 * u;
      ctx.stroke();
    }
    starPath(ctx, cx, starY + 1 * u, 13 * u);
    ctx.fillStyle = gold ? GOLD : lit ? STAR : 'rgba(210, 201, 250, 0.28)';
    ctx.fill();
  }

  // The score.
  const scoreY = top + songH + starsH + gap * 2;
  panel(ctx, left, scoreY, boxW, scoreH, 14 * u);
  font(ctx, 15 * u, 900);
  ctx.fillStyle = '#d2c9fa';
  const [first, ...rest] = f.scoreLabel.toUpperCase().split(' ');
  ctx.fillText(first, left + 18 * u, scoreY + 32 * u);
  ctx.fillText(rest.join(' '), left + 18 * u, scoreY + 50 * u);
  // A long score is set smaller, so it stays inside the panel beside its label.
  const label = Math.max(ctx.measureText(first).width, ctx.measureText(rest.join(' ')).width);
  const room = boxW - 18 * u - label - 14 * u - 22 * u;
  const text = Math.round(f.score).toLocaleString();
  font(ctx, 46 * u, 900);
  const size = Math.min(46 * u, (46 * u * room) / Math.max(1, ctx.measureText(text).width));
  font(ctx, size, 900);
  ctx.fillStyle = '#f6f3ff';
  ctx.textAlign = 'right';
  // Short of the panel's edge by the italic's lean.
  ctx.fillText(text, left + boxW - 22 * u, scoreY + scoreH / 2 + 16 * u - (46 * u - size) * 0.35);
  ctx.textAlign = 'left';

  if (f.deck) {
    const d = f.deck;
    // The multiplier dial on the deck, the overdrive meter arching over it.
    const r = Math.max(30 * u, Math.min(58 * u, (d.foot - d.y) * 0.39));
    const cx = d.x;
    const cy = Math.min(height - r - 8 * u, (d.y + d.foot) / 2);
    const colour = f.overdriveActive ? OD : (DIAL[f.level] ?? DIAL[1]);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
    ctx.fillStyle = f.overdriveActive ? 'rgba(20, 50, 80, 0.85)' : 'rgba(6, 4, 14, 0.78)';
    ctx.fill();
    ctx.lineWidth = r * 0.09;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.stroke();
    if (f.streakP > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f.streakP);
      ctx.strokeStyle = colour;
      ctx.stroke();
    }
    // The overdrive arc: from the lower left, over the top, to the lower right.
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.08;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.stroke();
    if (f.overdrive > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * Math.min(1, f.overdrive));
      ctx.strokeStyle = OD;
      ctx.shadowColor = OD;
      ctx.shadowBlur = f.overdriveActive || f.overdrive >= 0.25 ? 14 * u : 0;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.lineCap = 'butt';
    font(ctx, r * 0.62, 900);
    ctx.fillStyle = colour;
    ctx.textAlign = 'center';
    ctx.fillText(`×${f.multiplier}`, cx, cy + r * 0.22);

    // How the last note went: a tag beside the strike line, the streak above it once it counts.
    const fb = f.feedback;
    const life = 1.1;
    if (fb && fb.age < life) {
      const fade = fb.age < 0.08 ? fb.age / 0.08 : fb.age > life - 0.3 ? (life - fb.age) / 0.3 : 1;
      const pop = fb.age < 0.12 ? 1 + (0.12 - fb.age) * 1.6 : 1;
      const [c0, c1, ink] = TAG[fb.kind] ?? TAG.good;
      ctx.globalAlpha = Math.max(0, Math.min(1, fade));
      font(ctx, 30 * u * pop, 900);
      const tw = ctx.measureText(fb.text).width + 34 * u;
      const th = 46 * u * pop;
      const tx = Math.max(12 * u, d.x - d.width / 2 - tw - 18 * u);
      const ty = d.y - th / 2;
      ctx.save();
      ctx.translate(tx, ty);
      ctx.transform(1, 0, -0.18, 1, th * 0.09, 0);
      roundRect(ctx, 0, 0, tw, th, 8 * u);
      const g = ctx.createLinearGradient(0, 0, tw, 0);
      g.addColorStop(0, c0);
      g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.fillText(fb.text, tx + tw / 2, ty + th / 2 + 11 * u * pop);
      if (f.streak >= 5) {
        font(ctx, 38 * u, 900);
        ctx.fillStyle = f.level >= 6 ? GOLD : '#f6f3ff';
        ctx.fillText(String(f.streak), tx + tw / 2, ty - 12 * u);
      }
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
  }

  // The game's name in a corner, quietly.
  font(ctx, 22 * u, 900);
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = '#f6f3ff';
  ctx.textAlign = 'right';
  ctx.fillText('SOUNDWAVE', width - 28 * u, portrait ? height - 28 * u : 44 * u);
  ctx.globalAlpha = 1;
  ctx.restore();
}
