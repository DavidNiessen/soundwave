import * as THREE from 'three';
import type { Chart } from '../chart/types';
import type { GameEvent, GameSession } from '../game/GameSession';
import { MAX_MULTIPLIER, multiplierFor } from '../game/scoring';
import { DRIVE_KIND, PHRASE_KIND, TILE_BANDS, TILE_PALETTES, tileColour, type TileBand } from './tilePalette';

export const LANE_COLORS = [0x3ddc5a, 0xff3b4e, 0xffd23d, 0x3a8bff, 0xff8a1f];
const OVERDRIVE_COLOR = new THREE.Color(0xeaf6ff);
/** While overdrive lasts every tile on the lane is this light blue, and glows. */
const OVERDRIVE_TILE = new THREE.Color(0x7fd2ff);
const MISSED_TINT = 0.28;
const WHITE = new THREE.Color(0xffffff);
/** The rails and the deck's front lip: violet, gold on a full streak, overdrive's blue over both. */
const RAIL = new THREE.Color(0xbd78ff);
const STREAK_GOLD = new THREE.Color(0xffd66b);
/** The motes' own gold: deeper than the rails, so their white-hot cores stand out of it. */
const MOTE_GOLD = new THREE.Color(0xffb52e);
/** Motes of light let go by the rails each second while they are gold or in overdrive, and how many can float at once. */
const MOTE_RATE = 150;
const MAX_MOTES = 420;

const LANE_W = 1;
/** Where the strike line sits down the canvas when the layout does not say (see resize). */
const STRIKE_AT = 0.8;
/** Share of the canvas width the deck spans at the strike line, on a wide screen and on a tall one. */
const WIDE_SHARE = 0.37;
/** The camera's distances below give a share of 0.485 at the strike line: this moves it back to WIDE_SHARE. */
const BACK = 0.485 / WIDE_SHARE;
const TALL_SHARE = 0.9;
const LENGTH = 24;
/** How much of the deck before the strike line a Showdown hit leaves clear, units. */
const FOG_CLEAR = 1.2;
/**
 * How far the deck runs on past the strike line, toward the player: far enough to leave the foot
 * of the screen, so the multiplier dial and the lane labels stand on it.
 */
const FRONT = 3.6;
/** How far past the strike line a missed tile gets before it has shrunk away. */
const PAST = 0.72;
const MAX_GEMS = 512;
/** The stretch at the far end of the deck over which a note grows to its full size. */
const APPEAR = 4;
/** How far a thing far units in from the deck's far edge has arrived, 0..1, eased at both ends. */
const arrived = (far: number) => {
  const p = Math.min(1, Math.max(0, far / APPEAR));
  return p * p * (3 - 2 * p);
};

const MAX_TAILS = 128;
const MAX_LINES = 96;
const MAX_PARTICLES = 600;

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Blending for things that are pure light on the deck: their colour is added, and the canvas's own
 * opacity is left exactly as it was. (Plain additive blending also adds the quad's alpha, which
 * makes the slightly see-through deck fully opaque across the whole quad: a darker rectangle round
 * the light wherever the stage behind is bright.)
 */
const LIGHT = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

const highwayVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const highwayFragment = /* glsl */ `
  uniform float uLanes;
  uniform float uScroll;
  uniform float uOverdrive;
  uniform float uPulse;
  uniform float uGold;
  uniform float uLight[5];
  uniform vec3 uLaneCol[5];
  uniform float uLen;
  uniform float uFront;
  uniform float uTime;
  uniform float uTravel;
  varying vec2 vUv;
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    float x = vUv.x * uLanes;
    float lane = fract(x);
    // z: distance beyond the strike line in highway units (negative on the player's side of it).
    float z = vUv.y * uLen - uFront;
    float run = uLen - uFront;
    float depth = clamp(z / run, 0.0, 1.0);
    float ahead = step(0.0, z);
    // Hairlines between lanes (none along the outer edges, which have their rails), fainter in front of the strike line.
    float divider = smoothstep(0.024, 0.0, min(lane, 1.0 - lane)) * step(0.5, x) * step(x, uLanes - 0.5) * mix(0.45, 1.0, ahead);
    float edgeDist = min(vUv.x, 1.0 - vUv.x) * uLanes;
    float rail = smoothstep(0.075, 0.045, edgeDist);
    float railGlow = smoothstep(0.55, 0.0, edgeDist);
    float far = smoothstep(run, run * 0.6, z);
    // A solid violet deck, a shade lighter toward the far end, with a slow sheen running to the player.
    float sheen = 0.5 + 0.5 * sin((depth * 9.0 + uScroll) * 3.14159);
    vec3 base = mix(vec3(0.07, 0.038, 0.19), vec3(0.115, 0.062, 0.31), depth) + vec3(0.012, 0.008, 0.03) * sheen;
    // Neighbouring lanes differ by a breath, so each reads as its own strip.
    base *= 1.0 + 0.07 * (mod(floor(x), 2.0) - 0.5);
    // Like glass under stage light, the deck is lighter toward both rails and darkest down the middle.
    float side = 1.0 - min(vUv.x, 1.0 - vUv.x) * 2.0;
    base += vec3(0.085, 0.06, 0.2) * pow(side, 2.4);
    // Its surface is cut in large facets that travel with the notes; each catches the light a little
    // differently and brightens and fades on its own, a slow wave of light rolls across them toward
    // the player, and all of them answer the beat.
    vec2 g = vec2(x * 0.5 + 0.25, (z + uTravel) * 0.5);
    vec2 cell = floor(g);
    vec2 f = fract(g);
    vec2 id = vec2(cell.x, mod(cell.y, 8.0)) + step(f.x + f.y, 1.0) * 7.3;
    float facet = hash(id);
    float tone = hash(id + 17.7);
    float own = sin(uTime * (0.8 + 1.2 * tone) + tone * 6.2832);
    // The wave's phase steps a whole turn over the 8 rows the pattern repeats in, so it never jumps.
    float wave = sin(uTime * 1.6 + id.y * 0.7854 - cell.x * 1.1);
    base *= 1.0 + (facet - 0.5) * (0.16 + 0.2 * uPulse) + 0.13 * own + 0.09 * wave;
    // The glass is never quite still: soft patches of stage light drift slowly across it, sideways and
    // toward the player, on the clock rather than the song, so it lives on through a pause or a break.
    vec2 q = vec2(x * 0.8, z * 0.24);
    float drift = noise(q + vec2(uTime * 0.09, uTime * 0.16)) * 0.6 + noise(q * 2.3 + vec2(-uTime * 0.06, uTime * 0.27)) * 0.4;
    base += vec3(0.05, 0.034, 0.13) * smoothstep(0.42, 0.9, drift) * (0.45 + 0.55 * depth);
    // Every few seconds a faint, leaning glint runs down the deck, as if a light swept over it.
    float sweep = 1.25 - fract(uTime / 7.5) * 2.2;
    float glint = exp(-pow((depth + (vUv.x - 0.5) * 0.35 - sweep) * 9.0, 2.0));
    base += vec3(0.07, 0.06, 0.15) * glint * ahead;
    vec3 od = vec3(0.35, 0.65, 1.0);
    // The rails are violet, gold while the streak holds the top multiplier, and overdrive's blue over both.
    vec3 railCol = mix(mix(vec3(0.74, 0.47, 1.0), vec3(1.0, 0.9, 0.56), uGold), od, uOverdrive) * (1.0 + 0.55 * uPulse + 0.55 * uGold);
    vec3 col = base + divider * vec3(0.17, 0.14, 0.36) + railGlow * railGlow * railCol * (0.2 + 0.26 * uPulse + 0.45 * uGold);
    col = mix(col, railCol, rail);
    // In overdrive the edges light up light blue from inside too, in swells that run toward the player.
    float inner = smoothstep(0.16, 0.0, min(vUv.x, 1.0 - vUv.x));
    col += vec3(0.32, 0.7, 1.0) * inner * inner * uOverdrive * (0.45 + 0.4 * (0.5 + 0.5 * sin((vUv.y * 6.0 + uScroll) * 3.14159)));
    col += od * uOverdrive * 0.1 * (0.6 + 0.4 * sheen);
    // A lane that is played lights up along its length in its own colour, brightest at the player's end.
    float l = floor(x);
    vec3 beam = vec3(0.0);
    for (int i = 0; i < 5; i++) { if (float(i) == l) beam = uLaneCol[i] * uLight[i]; }
    float inLane = smoothstep(0.0, 0.06, lane) * smoothstep(1.0, 0.94, lane);
    col += beam * inLane * (0.1 + 0.42 * (1.0 - smoothstep(0.0, 17.0, max(z, 0.0))));
    // While it is lit, dashes of light run up its middle, away from the player.
    float dash = smoothstep(0.72, 0.8, fract(z * 0.7 - uTime * 4.0 + l * 0.31)) * smoothstep(0.17, 0.09, abs(lane - 0.5));
    col += beam * dash * 0.7 * (1.0 - smoothstep(0.0, 7.0, max(z, 0.0))) * ahead;
    gl_FragColor = vec4(col, 0.965 * far);
  }
`;
/**
 * Overdrive's light: a soft light-blue glow lying along the outside of both edges of the lane,
 * brightest at the edge, with slow swells running down it toward the player and a fine shimmer.
 */
/**
 * A Showdown hit: a sheet of wavy, shimmering bands lying over the deck from just past the strike
 * line to the horizon. Ridges warp from side to side and roll toward the player; their crests
 * stand up out of the deck (fogVertex), catch the light white and fringe into rainbow colours,
 * and the milky sheet between them blurs out what is underneath, so far notes are hard to read.
 * The strike line stays clear: the sheet fades in a little beyond it. It flashes as it lands (uFlash).
 */
const FOG_WAVES = /* glsl */ `
  uniform float uTime;
  // How far up the deck a point is (0 near, 1 far) and across it (0..1) -> the bands' phase there.
  float fogPhase(vec2 uv) {
    float bend = 0.16 * sin(uv.x * 8.0 + uTime * 1.3 + uv.y * 6.0)
      + 0.09 * sin(uv.x * 19.0 - uTime * 2.2 + uv.y * 11.0)
      + 0.05 * sin(uv.x * 37.0 + uTime * 3.1);
    return uv.y * 11.0 + uTime * 1.3 + bend * (0.8 + 1.2 * uv.y);
  }
`;

const fogVertex = /* glsl */ `
  uniform float uLevel;
  varying vec2 vUv;
  ${FOG_WAVES}
  void main() {
    vUv = uv;
    float s = sin(6.2831853 * fogPhase(uv));
    vec3 p = position;
    // The plane lies flat once turned: its own z is up.
    p.z += pow(max(0.0, s), 3.0) * 0.16 * uLevel * smoothstep(0.0, 0.15, uv.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fogFragment = /* glsl */ `
  uniform float uLevel;
  uniform float uFlash;
  varying vec2 vUv;
  ${FOG_WAVES}
  float crest(float phase, float sharp) { return pow(max(0.0, sin(6.2831853 * phase)), sharp); }
  void main() {
    float ph = fogPhase(vUv);
    float s = sin(6.2831853 * ph);
    float c = cos(6.2831853 * ph);
    // A crest's bright line, split into red, green and blue a hair apart: the rainbow fringe.
    float fringe = 0.034;
    vec3 line = vec3(crest(ph + fringe, 26.0), crest(ph, 30.0), crest(ph - fringe, 26.0));
    // Thin-film colours over each crest's shoulders, drifting along it.
    vec3 film = 0.5 + 0.5 * cos(6.2831853 * (ph * 0.5 + vUv.x * 0.7 + vec3(0.0, 0.33, 0.67)));
    float shoulder = smoothstep(0.35, 0.85, s) * (1.0 - smoothstep(0.92, 1.0, s));
    // The far side of each crest lies in its shadow.
    float shade = smoothstep(0.0, -0.9, c) * max(0.0, s);
    // Fine ripples between the crests, like the lines of a contour map.
    float ripple = pow(max(0.0, sin(6.2831853 * ph * 3.0 + 1.3)), 40.0) * (1.0 - max(0.0, s));
    vec3 milk = vec3(0.74, 0.72, 0.95);
    vec3 col = milk * (0.55 + 0.45 * max(0.0, s)) * (1.0 - 0.65 * shade);
    col += film * shoulder * 0.7 + line * 1.5 + milk * ripple * 0.5 + vec3(1.0, 0.92, 1.0) * uFlash * 0.6;
    float sides = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x);
    // Clear at the strike line, thick from a little beyond it to the horizon.
    float reach = smoothstep(0.0, 0.14, vUv.y);
    float alpha = (0.55 + 0.3 * max(0.0, s) + 0.3 * line.g + 0.15 * shoulder + 0.3 * shade) * sides * reach + uFlash * 0.3 * sides * reach;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95) * uLevel);
  }
`;

const glowFragment = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uFlare;
  uniform float uSide;
  uniform float uBlue;
  varying vec2 vUv;
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    // out: 0 at the lane's edge, 1 at the strip's outer rim; along: 0 at the strike line, 1 at the far end.
    float out_ = uSide > 0.0 ? vUv.x : 1.0 - vUv.x;
    float along = vUv.y;
    float swell = 0.5 + 0.5 * sin(along * 16.0 + uTime * 4.2);
    float shimmer = noise(vec2(along * 46.0 + uTime * 5.0, out_ * 3.0 - uTime * 1.3));
    float reach = 5.5 - 2.6 * swell - 1.5 * uFlare;
    float glow = exp(-out_ * reach) * (1.0 - out_) * (0.55 + 0.3 * swell + 0.3 * shimmer);
    float line = exp(-out_ * 40.0);
    // Gold for a full streak, light blue for overdrive.
    vec3 deep = mix(vec3(1.0, 0.62, 0.14), vec3(0.22, 0.6, 1.0), uBlue);
    vec3 pale = mix(vec3(1.0, 0.93, 0.66), vec3(0.55, 0.86, 1.0), uBlue);
    vec3 col = mix(deep, pale, line + 0.35 * swell * (1.0 - out_));
    float ends = smoothstep(1.0, 0.55, along) * smoothstep(0.0, 0.04, along);
    gl_FragColor = vec4(col * (1.0 + 0.8 * uFlare), (glow * 1.25 + 0.4 * line) * uLevel * ends);
  }
`;

/**
 * Pills of light: the strike targets, drawn from each point's distance to the pill's edge, so the
 * ring, the light inside it and the glow around it are all smooth at any size. The plane is larger
 * than the pill by the glow's reach; `uExtent` is its size, `uHalf` the pill's half size, `uRad` the
 * radius of its ends.
 */
const neonVertex = /* glsl */ `
uniform vec2 uExtent;
varying vec2 vP;
varying vec3 vCol;
void main() {
  vP = (uv - 0.5) * uExtent;
#ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
#else
  vCol = vec3(1.0);
#endif
  vec4 p = vec4(position, 1.0);
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * p;
}
`;
const neonPill = /* glsl */ `
uniform vec2 uHalf;
uniform float uRad;
float pill(vec2 p) {
  vec2 q = abs(p) - uHalf + uRad;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRad;
}
`;
const band = (kind: number, name: TileBand) => {
  const h = tileColour(kind, name);
  return new THREE.Vector3(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255);
};
const glslFloat = (x: number) => x.toFixed(5);

/** A tile: its full width (base plate included) and its height as painted, in highway units. */
const TILE_W = 0.84;
const TILE_H = 0.325;
/** How far the card a tile is painted on reaches beyond the bar: room for its glow and its shadow. */
const TILE_MARGIN = 0.12;
/**
 * How far a tile's card leans back from upright, radians: about as far as the deck falls away under
 * the camera's gaze, so a tile keeps its shape all the way down the lane.
 */
const TILE_LEAN = 0.44;
/**
 * A hold that must be let go on time: its neck, the wide channel of glass running from its tile to
 * where it is let go, and the crystal tip it ends in (width, and the tip's length along the lane);
 * the chevrons in the neck (their spacing and how fast they travel toward the tip, units a second).
 */
const NECK = { w: 0.52, arrow: 0.7, chevron: 0.62, travel: 1.6 } as const;

const tileCommon = /* glsl */ `
#define NB ${TILE_BANDS.length}
#define DRIVE ${DRIVE_KIND}
${TILE_BANDS.map((b, i) => `#define B_${b.toUpperCase()} ${i}`).join('\n')}
uniform vec3 uPal[${TILE_PALETTES.length * TILE_BANDS.length}];
float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
/** The palette of the tile kind \`k\`, turned \`drive\` of the way to overdrive's. */
vec3 pal(float k, float drive, int b) {
  return mix(uPal[int(k + 0.5) * NB + b], uPal[DRIVE * NB + b], drive);
}
float between(float x, float a, float b, float soft) {
  return smoothstep(a - soft, a + soft, x) * (1.0 - smoothstep(b - soft, b + soft, x));
}
`;

/**
 * Tiles are painted, not modelled: each is a card standing on the deck and leaning back, with a
 * glossy bar of coloured glass drawn on it. `aTile` is the tile's kind (a palette), how far it has
 * turned to overdrive's colours, its brightness, and 1 for the tile of a hold that must be let go
 * on time (lighter glass), else 0. `vP` is a point on the card in highway units: x across the bar,
 * y up from the deck.
 */
const tileVertex = /* glsl */ `
attribute vec4 aTile;
varying vec2 vP;
varying vec4 vTile;
void main() {
  vTile = aTile;
  vec2 p = vec2((uv.x - 0.5) * ${glslFloat(TILE_W + 2 * TILE_MARGIN)}, mix(${glslFloat(-TILE_MARGIN)}, ${glslFloat(TILE_H + TILE_MARGIN)}, uv.y));
  vP = p;
  // Leant back, with the bar's middle over the note's place on the deck.
  float c = cos(${glslFloat(TILE_LEAN)});
  float s = sin(${glslFloat(TILE_LEAN)});
  vec4 pos = vec4(p.x, p.y * c, (${glslFloat(TILE_H / 2)} - p.y) * s, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * pos;
}
`;

const tileFragment = /* glsl */ `
${tileCommon}
varying vec2 vP;
varying vec4 vTile;
#define W ${glslFloat(TILE_W / 2)}
#define H ${glslFloat(TILE_H)}
vec3 band(int b) { return pal(vTile.x, vTile.y, b); }

void main() {
  vec2 p = vP;
  // The bar: a box with well rounded corners, its foot flaring out a little into the pale rim it
  // stands on.
  float flare = ${glslFloat(TILE_W * 0.022)} * (1.0 - smoothstep(0.0, H * 0.4, p.y));
  float bx = W - ${glslFloat(TILE_W * 0.022)};
  vec2 bc = vec2(0.0, H * 0.5);
  vec2 bb = vec2(bx, H * 0.5);
  vec2 pb = vec2(p.x * bx / (bx + flare), p.y);
  float r = pb.y > bc.y ? H * 0.42 : H * 0.3;
  vec2 q = abs(pb - bc) - bb + r;
  float dB = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  float d = dB;
  float aa = fwidth(d) * 1.3;
  float bar = 1.0 - smoothstep(-aa, aa, d);
  float v = p.y / H;
  float u = pb.x / bx;

  // Its face, in bands from the top down: the upper band darkening a little toward the dip.
  vec3 c = band(B_UP) * mix(1.06, 0.9, smoothstep(0.8, 0.64, v));
  c = mix(c, band(B_DIP), smoothstep(0.66, 0.6, v));
  c = mix(c, band(B_MID), smoothstep(0.56, 0.51, v));
  c = mix(c, band(B_LOW), smoothstep(0.47, 0.37, v));
  c = mix(c, band(B_RISE), smoothstep(0.26, 0.17, v));
  // A window of reflected light over its upper right, reaching lower toward its right end.
  float reach = 0.6 - 0.14 * u;
  float g = smoothstep(-0.25, 0.85, u) * smoothstep(reach - 0.06, reach + 0.1, v);
  vec3 shine = mix(band(B_UP) * 1.3 + 0.08, band(B_GLARE), smoothstep(0.56, 0.74, v));
  c = mix(c, shine, g);

  // Its rim, all round: the top edge a shade darker with a line of light just inside it, which runs
  // round the left corner into a streak down the middle of the left end; the right end lit.
  float depth = -dB;
  vec2 n = max(q.x, q.y) > 0.0 ? normalize(max(q, 0.0) + 1e-6) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  n *= sign(pb - bc + 1e-6);
  float top = smoothstep(0.1, 0.7, n.y);
  float bottom = smoothstep(0.1, 0.7, -n.y);
  float left = smoothstep(0.2, 0.8, -n.x);
  float right = smoothstep(0.2, 0.8, n.x);
  vec3 hi = mix(band(B_HI), band(B_GLARE), smoothstep(-0.6, 1.0, u) * 0.65);
  c = mix(c, hi, top * between(depth, H * 0.075, H * 0.16, H * 0.025));
  c = mix(c, band(B_STREAK), left * (1.0 - top) * smoothstep(0.24, 0.4, v) * between(depth, H * 0.1, H * 0.24, H * 0.03));
  c = mix(c, band(B_EDGE), left * (1.0 - top) * (1.0 - smoothstep(H * 0.04, H * 0.08, depth)) * 0.65);
  c = mix(c, band(B_UP) * 1.2, right * smoothstep(0.2, 0.32, v) * smoothstep(0.62, 0.45, v) * between(depth, H * 0.03, H * 0.15, H * 0.02));
  c = mix(c, band(B_EDGE), top * (1.0 - smoothstep(H * 0.02, H * 0.06, depth)) * 0.6);
  // The foot: a pale rim along the bottom, thick in the middle and thinning as it curls up round
  // both ends; its lowest edge a shade darker.
  float thick = H * mix(0.05, 0.13, bottom);
  float foot = smoothstep(0.4, 0.2, v) * (1.0 - smoothstep(thick - H * 0.02, thick + H * 0.02, depth));
  c = mix(c, mix(band(B_BASE) * 0.8, band(B_BASE), smoothstep(0.0, H * 0.05, p.y)), foot);

  // The tile of a hold that must be let go on time is lighter glass, with pale edges.
  if (vTile.w > 0.0) {
    c = mix(c, band(B_BASE) * 0.72, 0.22);
    c = mix(c, mix(band(B_BASE), vec3(1.0), 0.2), (1.0 - smoothstep(H * 0.04, H * 0.09, depth)) * (1.0 - foot) * 0.85);
  }

  // Outside the bar: its shadow on the deck in front of it, and a little of its light round it
  // (more above it than beside it). A tile that holds overdrive glows white, and further.
  float phrase = step(${PHRASE_KIND - 0.5}, vTile.x) * step(vTile.x, ${PHRASE_KIND + 0.5});
  float out_ = max(d, 0.0);
  float above = mix(0.3, 1.0, smoothstep(H * 0.3, H * 1.1, p.y));
  float halo = exp(-out_ / mix(0.024, 0.03, phrase)) * mix(0.5, 0.42, phrase) * above * (1.0 - smoothstep(${glslFloat(TILE_MARGIN * 0.6)}, ${glslFloat(TILE_MARGIN)}, out_));
  float shadow = (1.0 - smoothstep(0.0, H * 0.14, -p.y)) * step(p.y, 0.0) * (1.0 - smoothstep(W - 0.04, W + 0.01, abs(p.x)));

  float dim = vTile.z;
  vec3 col = c * bar;
  float a = bar;
  float sh = (1.0 - a) * shadow * 0.75;
  vec3 lightCol = band(B_HALO) * halo * (1.0 - a);
  gl_FragColor = vec4((col + lightCol) * dim, a + sh + halo * 0.2 * (1.0 - a));
}
`;

/** A sustain's rod: its width, and how far its glow reaches beside it (in rod widths). */
const ROD_W = 0.11;
const ROD_SPAN = 3;
/** A sustain is a rod lying along the lane: lit along both sides, shaded down its middle. */
const rodVertex = /* glsl */ `
attribute vec4 aRod;
varying vec2 vUv;
varying vec4 vRod;
void main() {
  vUv = uv;
  vRod = aRod;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const rodFragment = /* glsl */ `
${tileCommon}
varying vec2 vUv;
varying vec4 vRod;
void main() {
  // aRod: kind, overdrive, brightness, glow. The rod is |s| < 1; its glow reaches to ROD_SPAN.
  float s = (vUv.x - 0.5) * ${glslFloat(2 * ROD_SPAN)};
  float t = abs(s);
  float aa = fwidth(s);
  float body = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, t);
  vec3 hi = pal(vRod.x, vRod.y, B_RODHI);
  vec3 lo = pal(vRod.x, vRod.y, B_RODLO);
  vec3 c = mix(lo, hi, exp(-pow((t - 0.5) / 0.3, 2.0))) * 1.2;
  c *= mix(1.0, 0.65, smoothstep(0.75, 1.0, t));
  float glow = vRod.w * exp(-max(t - 1.0, 0.0) * 1.6) * (1.0 - smoothstep(${glslFloat(ROD_SPAN * 0.6)}, ${glslFloat(ROD_SPAN)}, t));
  vec3 light = pal(vRod.x, vRod.y, B_HALO) * glow * (1.0 - body);
  gl_FragColor = vec4((c * body + mix(c, vec3(1.0), 0.35) * body * vRod.w * 0.4) * vRod.z + light, body + glow * 0.12 * (1.0 - body));
}
`;

/**
 * A hold that must be let go on time runs as a neck: a wide channel of tinted glass lying along the
 * lane from its tile, framed in pale glass, with chevrons inside it forever travelling toward the
 * pale crystal tip it ends in. Dark while it waits; held, it lights up in its lane's colour and its
 * chevrons run brighter. `aNeck` is the kind, overdrive, brightness and the length drawn; `aNeckEnd`
 * how far the tip is from the start, and 1 while it is held.
 */
const neckVertex = /* glsl */ `
attribute vec4 aNeck;
attribute vec2 aNeckEnd;
varying vec2 vUv;
varying vec4 vNeck;
varying vec2 vEnd;
void main() {
  vUv = uv;
  vNeck = aNeck;
  vEnd = aNeckEnd;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const NECK_QUAD = NECK.w + 0.08;
const neckFragment = /* glsl */ `
${tileCommon}
uniform float uTime;
varying vec2 vUv;
varying vec4 vNeck;
varying vec2 vEnd;
void main() {
  float along = vUv.y * vNeck.w;
  float s = (vUv.x - 0.5) * ${glslFloat(NECK_QUAD)};
  float hw = ${glslFloat(NECK.w / 2)};
  float shoulder = vEnd.x - ${glslFloat(NECK.arrow)};
  float lit = vEnd.y;
  // Inside the channel, and inside the tip's two edges.
  float dSide = abs(s) - hw;
  float dTip = dot(vec2(abs(s) - hw, along - shoulder), normalize(vec2(${glslFloat(NECK.arrow)}, hw)));
  float d = max(dSide, dTip);
  float aa = fwidth(d) * 1.3;
  float inside = 1.0 - smoothstep(-aa, aa, d);
  vec3 low = pal(vNeck.x, vNeck.y, B_LOW);
  vec3 up = pal(vNeck.x, vNeck.y, B_UP);
  vec3 base = pal(vNeck.x, vNeck.y, B_BASE);
  vec3 white = vec3(1.0);
  // The glass: deep and dark while it waits, its lane's own colour once held; a little lighter
  // down its middle.
  vec3 tint = mix(mix(low * 0.75, up, 0.08), up * 1.05, lit);
  float x = s / hw;
  vec3 col = tint * (0.8 + 0.3 * (1.0 - x * x));
  // Chevrons pointing to the tip, travelling toward it.
  float c = (along + abs(s) * 0.85 - uTime * mix(${glslFloat(NECK.travel)}, ${glslFloat(NECK.travel * 1.6)}, lit)) / ${glslFloat(NECK.chevron)};
  float f = fract(c);
  float chev = smoothstep(0.0, 0.2, f) * smoothstep(0.55, 0.3, f) * smoothstep(shoulder, shoulder - 0.25, along);
  col = mix(col, mix(tint * 1.6, mix(up, base, 0.45), 0.5 + 0.3 * lit), chev * mix(0.3, 0.5, lit));
  // Light from the tip falls a little way into the glass under it.
  col = mix(col, mix(base, tint, 0.55) * 0.75, smoothstep(0.35, 0.0, shoulder - along) * 0.6);
  // The frame: pale glass down both sides.
  float frame = 1.0 - smoothstep(0.028, 0.05, -d);
  col = mix(col, mix(base, white, 0.25) * mix(0.82, 1.0, lit), frame);
  // The tip: pale crystal, nearly white at its rim, with a bright line across its foot.
  float tip = smoothstep(shoulder - 0.008, shoulder + 0.008, along);
  vec3 facet = mix(mix(base, white, 0.45) * 0.68, mix(base, white, 0.6) * 0.86, smoothstep(0.16, 0.08, -d));
  col = mix(col, mix(facet, mix(base, white, 0.82), smoothstep(0.05, 0.02, -d)), tip);
  col = mix(col, mix(base, white, 0.72), exp(-pow((along - shoulder) / 0.03, 2.0)));
  gl_FragColor = vec4(col * vNeck.z * inside, inside * mix(0.9, 0.97, max(lit, tip)));
}
`;

/**
 * A strike target, an island on the deck: a thin ring of its lane's light round dark glass. Pressed
 * (`uPress`), it fills with light and its middle glows white; struck (`uFlash`), the white flares. The light rising from the ring is drawn by islandWallFragment.
 * The plane lies on the deck, with y toward the far end.
 */
const islandFragment = /* glsl */ `
${neonPill}
uniform vec3 uNeon;
uniform vec3 uCore;
uniform vec3 uFill;
uniform float uPress;
uniform float uFlash;
varying vec2 vP;
void main() {
  float d = pill(vP);
  float aa = fwidth(d);
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float lit = clamp(uPress, 0.0, 1.0);
  float line = exp(-pow(d / mix(0.015, 0.018, lit), 2.0));
  float core = exp(-pow(d / mix(0.006, 0.009, lit), 2.0));
  // Inside: dark glass with a tint of the lane, a little lighter toward the ring.
  float near = inside * exp(d / 0.05);
  vec3 col = uNeon * (0.2 + 0.45 * near) * inside;
  float a = inside * 0.62;
  // Pressed, it fills with light, white-hot in the middle.
  vec3 fill = uFill * (0.8 + 0.3 * near);
  col = mix(col, fill, inside * lit);
  a = mix(a, 1.0, inside * lit);
  vec2 f = vP / vec2(uHalf.x * 0.55, uHalf.y * 0.9);
  float flare = exp(-dot(f, f) * 1.6);
  col += vec3(1.0) * flare * inside * clamp(lit * 0.62 + uFlash, 0.0, 1.0);
  // The ring.
  vec3 ringCol = mix(uNeon, uCore, clamp(core * 0.75 + lit * 0.3, 0.0, 1.0));
  col += ringCol * line * (1.1 + 0.4 * lit);
  a = max(a, line * 0.9);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;
/** The light rising from an island's ring: strongest at the deck, gone a little way up. */
const islandWallFragment = /* glsl */ `
uniform vec3 uNeon;
uniform float uLevel;
varying vec2 vUv;
void main() {
  float up = vUv.y;
  float l = pow(1.0 - up, 2.2) * uLevel;
  gl_FragColor = vec4(uNeon * l, 1.0);
}
`;
/** A pressed lane's column of light, standing over its island and fading as it rises. */
const pillarFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uLevel;
varying vec2 vUv;
void main() {
  float across = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
  float up = pow(1.0 - vUv.y, 1.4) * smoothstep(0.0, 0.05, vUv.y);
  gl_FragColor = vec4(uColor * across * up * uLevel, 1.0);
}
`;
/** How far beyond an island its plane reaches: room for its ring's light. */
const ISLAND_REACH = 0.08;
/** How high the light rising from an island's ring reaches, and a pressed lane's column of light. */
const WALL_H = 0.09;
const PILLAR = { w: 0.82, h: 0.7 } as const;
const TARGETS = {
  pill: { half: [0.42, 0.13], rad: 0.13 },
  square: { half: [0.45, 0.42], rad: 0.16 },
} as const;

/** A strip of wall standing on the outline of a rounded box (half size `hx`, `hy`, corner radius `r`), `h` high, with `uv.y` going up. */
function outlineWall(hx: number, hy: number, r: number, h: number): THREE.BufferGeometry {
  const pts: [number, number][] = [];
  const corner = 12;
  const centres: [number, number, number][] = [
    [hx - r, hy - r, 0],
    [-(hx - r), hy - r, Math.PI / 2],
    [-(hx - r), -(hy - r), Math.PI],
    [hx - r, -(hy - r), (3 * Math.PI) / 2],
  ];
  for (const [cx, cy, a0] of centres) {
    for (let i = 0; i <= corner; i++) {
      const a = a0 + (i / corner) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  pts.push(pts[0]);
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  pts.forEach(([x, y], i) => {
    // The outline lies on the deck: its y runs toward the far end (-z).
    pos.push(x, 0, -y, x, h, -y);
    uv.push(i / (pts.length - 1), 0, i / (pts.length - 1), 1);
    if (i > 0) {
      const a = (i - 1) * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

const moteVertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aStar;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStar;
  void main() {
    vColor = color;
    vAlpha = aAlpha;
    vStar = aStar;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(3.0, aSize * uScale / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

/**
 * A mote of fairy dust: a small solid core, white hot in the middle, in a tight halo of its own
 * colour. Some carry a four-pointed glint.
 */
const moteFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStar;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    float core = smoothstep(0.36, 0.16, d);
    float halo = exp(-d * d * 5.5) * 0.6;
    float rays = max(0.0, 1.0 - abs(p.x) * 30.0) * max(0.0, 1.0 - abs(p.y) * 2.3) + max(0.0, 1.0 - abs(p.y) * 30.0) * max(0.0, 1.0 - abs(p.x) * 2.3);
    float a = clamp(core + halo + rays * vStar, 0.0, 1.0) * vAlpha;
    gl_FragColor = vec4(mix(vColor, vec3(1.0, 0.98, 0.9), core * 0.75), a);
  }
`;
/**
 * The 3D note highway: track, strike pads, gems, sustain tails, beat lines and hit effects.
 * The canvas is transparent so a 2D background can sit behind it.
 */
export class Highway {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
  private readonly root = new THREE.Group();
  private readonly trackMat: THREE.ShaderMaterial;
  private readonly glowMats: THREE.ShaderMaterial[] = [];
  /** Showdown's Fog: 1 while a hit hazes the far highway, 0 otherwise (it fades between). */
  fog = 0;
  private readonly fogMat = new THREE.ShaderMaterial({
    vertexShader: fogVertex,
    fragmentShader: fogFragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: { uLevel: { value: 0 }, uTime: { value: 0 }, uFlash: { value: 0 } },
  });
  private fogMesh: THREE.Mesh | null = null;
  private readonly glow = new THREE.Group();
  private lip!: THREE.MeshBasicMaterial;
  /** The motes of light beside the rails (see floatMotes). */
  private motes!: THREE.Points;
  private readonly mPos = new Float32Array(MAX_MOTES * 3);
  private readonly mVel = new Float32Array(MAX_MOTES * 3);
  private readonly mCol = new Float32Array(MAX_MOTES * 3);
  private readonly mSize = new Float32Array(MAX_MOTES);
  private readonly mAlpha = new Float32Array(MAX_MOTES);
  private readonly mStar = new Float32Array(MAX_MOTES);
  private readonly mPeak = new Float32Array(MAX_MOTES);
  private readonly mSpan = new Float32Array(MAX_MOTES);
  private readonly mLife = new Float32Array(MAX_MOTES);
  private moteNext = 0;
  /** Motes owed since the last frame (a fraction carries over). */
  private moteDebt = 0;
  private flare = 0;
  /** The tiles, painted on cards (see tileFragment), drawn from the far end in, so a nearer tile covers a further one. */
  private readonly gems: THREE.InstancedMesh;
  private readonly gemData = new Float32Array(MAX_GEMS * 4);
  /** The tiles of this frame before they are sorted: z, x, scale, kind, overdrive, brightness, lighter glass. */
  private readonly gemList = new Float32Array(MAX_GEMS * 7);
  private readonly gemOrder: number[] = [];
  /** Sustain rods (see rodFragment). */
  private readonly tails: THREE.InstancedMesh;
  private readonly tailData = new Float32Array(MAX_TAILS * 4);
  /** The necks of holds that must be let go on time, each ending in its arrow (see neckFragment). */
  private readonly necks: THREE.InstancedMesh;
  private readonly neckData = new Float32Array(MAX_TAILS * 4);
  private readonly neckEnd = new Float32Array(MAX_TAILS * 2);
  private readonly lines: THREE.InstancedMesh;
  /** The strike targets: islands of glass ringed with their lanes' light (see islandFragment). */
  private readonly pads: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  /** The light rising from each island's ring, and a pressed lane's column of light. */
  private readonly walls: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];
  private readonly pillars: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private padStyle: 'pill' | 'square' = 'pill';
  private readonly flashLife: Float32Array;
  private readonly padLight: Float32Array;
  private readonly particles: THREE.Points;
  private readonly pPos: Float32Array;
  private readonly pVel: Float32Array;
  private readonly pCol: Float32Array;
  private readonly pLife: Float32Array;
  private pNext = 0;
  private readonly laneColors: THREE.Color[];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private firstNote = 0;
  private firstBeat = 0;
  private lastFrame = performance.now();
  private shake = 0;
  private pulse = 0;
  /** The music's push on the deck's light, eased (see render). */
  private beatGlow = 0;
  private readonly lanes: number;
  private readonly width: number;
  private unsub: (() => void) | null = null;
  /**
   * Resolves once every shader the highway uses is compiled. Until then nothing is drawn: compiled
   * on the first frame instead, they would hold the page up for a good part of a second as the song
   * starts. Compiled in parallel, they are done well inside the countdown.
   */
  readonly ready: Promise<void>;
  private compiled = false;

  /** Highway units per second. */
  speed = 9;

  /** How far ahead (seconds) notes are on screen at the current speed. */
  get horizon(): number {
    return LENGTH / this.speed;
  }

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly chart: Chart,
  ) {
    this.lanes = chart.lanes;
    this.width = this.lanes * LANE_W;
    this.laneColors = LANE_COLORS.slice(0, this.lanes).map((c) => new THREE.Color(c));
    this.flashLife = new Float32Array(this.lanes);
    this.padLight = new Float32Array(this.lanes);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setClearColor(0x000000, 0);

    this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xbfc8ff, 0x1a1030, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(0, 6, 4);
    this.scene.add(key);

    // Track
    this.trackMat = new THREE.ShaderMaterial({
      vertexShader: highwayVertex,
      fragmentShader: highwayFragment,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uLanes: { value: this.lanes },
        uScroll: { value: 0 },
        uOverdrive: { value: 0 },
        uPulse: { value: 0 },
        uGold: { value: 0 },
        uLight: { value: [0, 0, 0, 0, 0] },
        uLaneCol: { value: LANE_COLORS.map((c) => new THREE.Color(c)) },
        uLen: { value: LENGTH + FRONT },
        uFront: { value: FRONT },
        uTime: { value: 0 },
        uTravel: { value: 0 },
      },
    });
    const trackLen = LENGTH + FRONT;
    const track = new THREE.Mesh(new THREE.PlaneGeometry(this.width + 0.12, trackLen), this.trackMat);
    track.rotation.x = -Math.PI / 2;
    track.position.set(0, -0.02, -trackLen / 2 + FRONT);
    // The deck ends in a lit lip, the same light as its rails.
    const lip = new THREE.Mesh(new THREE.BoxGeometry(this.width + 0.12, 0.05, 0.07), new THREE.MeshBasicMaterial({ color: RAIL }));
    lip.position.set(0, -0.02, FRONT);
    this.root.add(lip);
    this.lip = lip.material as THREE.MeshBasicMaterial;
    track.renderOrder = -2;
    this.root.add(track);

    // A Showdown hit: from a little beyond the strike line to the horizon, finely cut so its crests can stand up.
    const fogLen = LENGTH - FOG_CLEAR;
    const fog = new THREE.Mesh(new THREE.PlaneGeometry(this.width + 0.3, fogLen, 24, 240), this.fogMat);
    fog.rotation.x = -Math.PI / 2;
    fog.position.set(0, 0.05, -FOG_CLEAR - fogLen / 2);
    fog.renderOrder = 5;
    fog.visible = false;
    this.fogMesh = fog;
    this.root.add(fog);

    // Overdrive's light: a strip of glow lying flat along the outside of each edge.
    const glowWidth = 1.1;
    for (const side of [-1, 1]) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: highwayVertex,
        fragmentShader: glowFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uFlare: { value: 0 }, uSide: { value: side }, uBlue: { value: 1 } },
      });
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(glowWidth, trackLen), mat);
      strip.rotation.x = -Math.PI / 2;
      // it starts just inside the edge, so no dark line shows between the lane and its glow
      strip.position.set(side * (this.width / 2 + 0.03 + glowWidth / 2), -0.015, -trackLen / 2 + FRONT);
      strip.renderOrder = -1.5;
      this.glowMats.push(mat);
      this.glow.add(strip);
    }
    this.glow.visible = false;
    this.root.add(this.glow);

    // Beat / bar lines
    this.lines = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xd9c8ff, transparent: true, opacity: 0.2, depthWrite: false }),
      MAX_LINES,
    );
    this.lines.renderOrder = -1;
    this.lines.frustumCulled = false;
    this.root.add(this.lines);

    // Strike targets: an island per lane, ringed with its colour's light and dark until the lane is
    // played. On a touchscreen the targets are the buttons, so there they are squares a finger fits on.
    for (let i = 0; i < this.lanes; i++) {
      const kind = i;
      const up = band(kind, 'up');
      const base = band(kind, 'base');
      const halo = band(kind, 'halo');
      const pad = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
          vertexShader: neonVertex,
          fragmentShader: islandFragment,
          transparent: true,
          premultipliedAlpha: true,
          depthWrite: false,
          uniforms: {
            uExtent: { value: new THREE.Vector2() },
            uHalf: { value: new THREE.Vector2() },
            uRad: { value: 0 },
            uNeon: { value: halo.clone().lerp(up, 0.3) },
            uCore: { value: band(kind, 'hi').lerp(new THREE.Vector3(1, 1, 1), 0.35) },
            uFill: { value: up.clone().lerp(base, 0.42) },
            uPress: { value: 0 },
            uFlash: { value: 0 },
          },
        }),
      );
      pad.quaternion.copy(this.flat);
      pad.position.set(this.laneX(i), 0.004, 0);
      pad.renderOrder = -0.5;
      this.root.add(pad);
      this.pads.push(pad);
      const wall = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.ShaderMaterial({
          vertexShader: highwayVertex,
          fragmentShader: islandWallFragment,
          ...LIGHT,
          side: THREE.DoubleSide,
          uniforms: { uNeon: { value: halo.clone().lerp(up, 0.3) }, uLevel: { value: 1 } },
        }),
      );
      wall.position.set(this.laneX(i), 0.004, 0);
      wall.renderOrder = -0.4;
      this.root.add(wall);
      this.walls.push(wall);
      const pillar = new THREE.Mesh(
        new THREE.PlaneGeometry(PILLAR.w, PILLAR.h),
        new THREE.ShaderMaterial({
          vertexShader: highwayVertex,
          fragmentShader: pillarFragment,
          ...LIGHT,
          uniforms: { uColor: { value: up.clone().lerp(new THREE.Vector3(1, 1, 1), 0.6) }, uLevel: { value: 0 } },
        }),
      );
      pillar.geometry.translate(0, PILLAR.h / 2, 0);
      pillar.position.set(this.laneX(i), 0.004, 0);
      pillar.renderOrder = 0.5;
      pillar.visible = false;
      this.root.add(pillar);
      this.pillars.push(pillar);
    }
    this.shapePads('pill');

    // Tiles, and the release markers at the end of hold-and-release tails, painted on cards (one
    // unit square each: the shader sizes it and leans it back).
    const palette = TILE_PALETTES.flatMap((_, k) => TILE_BANDS.map((b) => band(k, b)));
    const tileGeo = new THREE.PlaneGeometry(1, 1);
    tileGeo.setAttribute('aTile', new THREE.InstancedBufferAttribute(this.gemData, 4));
    this.gems = new THREE.InstancedMesh(
      tileGeo,
      new THREE.ShaderMaterial({
        vertexShader: tileVertex,
        fragmentShader: tileFragment,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
        uniforms: { uPal: { value: palette } },
      }),
      MAX_GEMS,
    );
    this.gems.frustumCulled = false;
    this.gems.renderOrder = 1;
    this.root.add(this.gems);
    // Sustain rods: lying along the lane from the tile to the end of the hold.
    const tailGeo = new THREE.PlaneGeometry(1, 1);
    tailGeo.rotateX(-Math.PI / 2);
    tailGeo.translate(0, 0, -0.5); // extends from z=0 to z=-1 before scaling
    tailGeo.setAttribute('aRod', new THREE.InstancedBufferAttribute(this.tailData, 4));
    this.tails = new THREE.InstancedMesh(
      tailGeo,
      new THREE.ShaderMaterial({
        vertexShader: rodVertex,
        fragmentShader: rodFragment,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
        uniforms: { uPal: { value: palette } },
      }),
      MAX_TAILS,
    );
    this.tails.frustumCulled = false;
    this.tails.renderOrder = 0;
    this.root.add(this.tails);
    const neckGeo = new THREE.PlaneGeometry(1, 1);
    neckGeo.rotateX(-Math.PI / 2);
    neckGeo.translate(0, 0, -0.5);
    neckGeo.setAttribute('aNeck', new THREE.InstancedBufferAttribute(this.neckData, 4));
    neckGeo.setAttribute('aNeckEnd', new THREE.InstancedBufferAttribute(this.neckEnd, 2));
    this.necks = new THREE.InstancedMesh(
      neckGeo,
      new THREE.ShaderMaterial({
        vertexShader: neckVertex,
        fragmentShader: neckFragment,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
        uniforms: { uPal: { value: palette }, uTime: { value: 0 } },
      }),
      MAX_TAILS,
    );
    this.necks.frustumCulled = false;
    this.necks.renderOrder = 0;
    this.root.add(this.necks);

    const tex = radialTexture();

    // Particles
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.particles = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({
        size: 0.16,
        map: tex,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.particles.frustumCulled = false;
    this.root.add(this.particles);

    // Motes: points drawn as soft discs, each with its own size (in highway units) and strength.
    const mGeo = new THREE.BufferGeometry();
    mGeo.setAttribute('position', new THREE.BufferAttribute(this.mPos, 3));
    mGeo.setAttribute('color', new THREE.BufferAttribute(this.mCol, 3));
    mGeo.setAttribute('aSize', new THREE.BufferAttribute(this.mSize, 1));
    mGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.mAlpha, 1));
    mGeo.setAttribute('aStar', new THREE.BufferAttribute(this.mStar, 1));
    this.motes = new THREE.Points(
      mGeo,
      new THREE.ShaderMaterial({
        vertexShader: moteVertex,
        fragmentShader: moteFragment,
        uniforms: { uScale: { value: 600 } },
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.motes.frustumCulled = false;
    this.motes.visible = false;
    this.motes.renderOrder = 3;
    this.root.add(this.motes);

    this.resize();
    this.ready = this.compile();
  }

  private compile(): Promise<void> {
    // Three only compiles what is visible: what starts hidden (the overdrive glow, the motes) is
    // shown just while the materials are gathered (that part is immediate).
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    const done = this.renderer.compileAsync(this.scene, this.camera);
    for (const o of hidden) o.visible = false;
    return done.then(
      () => void (this.compiled = true),
      () => void (this.compiled = true),
    );
  }

  attach(session: GameSession) {
    this.unsub?.();
    this.unsub = session.on((e) => this.onEvent(e));
  }

  private laneX(i: number) {
    return (i - (this.lanes - 1) / 2) * LANE_W;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // How much of the width the strike line takes: under half on a wide screen, nearly all of it
    // on a tall one, where the lanes also have to be wide enough for fingers.
    const a = this.camera.aspect;
    const css = getComputedStyle(this.canvas);
    // A layout played by touch asks for a minimum share (--deck-share), on wide screens too.
    const asked = Number.parseFloat(css.getPropertyValue('--deck-share')) || 0;
    const share = Math.max(asked, WIDE_SHARE + (TALL_SHARE - WIDE_SHARE) * Math.min(1, Math.max(0, (1.5 - a) / (1.5 - 0.65))));
    // The camera's distance: 5 lanes pull it back a little, a narrow screen brings it in. Without
    // a share asked for, a screen wider than 3:2 keeps the deck at its size and gains room at the sides.
    const back = this.lanes === 5 ? 1.12 : 1;
    const fit = (asked ? 1.5 / a : Math.max(1, 1.5 / a)) * (WIDE_SHARE / share);
    this.camera.position.set(0, 3.6 * back * fit * BACK, 6 * back * fit * BACK);
    this.camera.lookAt(0, 0, -7.5);
    // The picture is then slid up or down so the strike line sits where the layout wants it (a
    // share of the canvas height, from the canvas's own --strike), with the lane labels, the
    // multiplier dial or the touch pads below.
    this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    const strike = Number.parseFloat(css.getPropertyValue('--strike')) || STRIKE_AT;
    this.setPadStyle(css.getPropertyValue('--pads').trim() === 'square' ? 'square' : 'pill');
    // What --strike places: the strike line itself, or for touch the foot of the square targets.
    const anchor = this.padStyle === 'square' ? PAST + 0.16 : 0;
    const now = ((1 - new THREE.Vector3(0, 0, anchor).project(this.camera).y) / 2) * h;
    this.camera.setViewOffset(w, h, 0, Math.round(now - strike * h), w, h);
    this.camera.updateProjectionMatrix();
    // A mote's size is in highway units: this turns it into pixels at its distance.
    (this.motes.material as THREE.ShaderMaterial).uniforms.uScale.value =
      (h * this.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }
  /** Strike targets as thin pills, or as finger-sized squares set a little toward the player. */
  private setPadStyle(style: 'pill' | 'square') {
    if (style === this.padStyle) return;
    this.padStyle = style;
    this.shapePads(style);
  }

  private shapePads(style: 'pill' | 'square') {
    const { half, rad } = TARGETS[style];
    const w = (half[0] + ISLAND_REACH) * 2;
    const h = (half[1] + ISLAND_REACH) * 2;
    const z = style === 'square' ? 0.2 : 0;
    for (const pad of this.pads) {
      pad.scale.set(w, h, 1);
      pad.position.z = z;
      const u = pad.material.uniforms;
      (u.uExtent.value as THREE.Vector2).set(w, h);
      (u.uHalf.value as THREE.Vector2).set(half[0], half[1]);
      u.uRad.value = rad;
    }
    for (const wall of this.walls) {
      wall.geometry.dispose();
      wall.geometry = outlineWall(half[0], half[1], rad, WALL_H);
      wall.position.z = z;
    }
    for (const pillar of this.pillars) pillar.position.z = z;
  }

  /**
   * Screen positions (CSS px, relative to the canvas) of each lane's middle, `z` highway units on
   * the player's side of the strike line (0 = on the line).
   */
  padScreenPositions(z = 0): { x: number; y: number }[] {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.camera.updateMatrixWorld();
    return Array.from({ length: this.lanes }, (_, i) => {
      const p = new THREE.Vector3(this.laneX(i), 0, z).project(this.camera);
      return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
    });
  }

  /**
   * Where the lanes' labels stand: each lane's middle on the deck, `margin` CSS px above the foot
   * of the canvas (or at the deck's front edge, should that come first).
   */
  footRow(margin: number): { x: number; y: number }[] {
    const h = this.canvas.clientHeight || 1;
    const eye = this.camera.position;
    this.camera.updateMatrixWorld();
    this.v
      .set(0, 1 - ((h - margin) / h) * 2, 0.5)
      .unproject(this.camera)
      .sub(eye);
    const z = this.v.y < -1e-4 ? eye.z + this.v.z * (-eye.y / this.v.y) : 1.4;
    return this.padScreenPositions(Math.min(FRONT - 0.3, Math.max(0.9, z)));
  }

  /**
   * The lane under a point of the canvas (CSS px): the lane drawn there, following the deck's
   * perspective. Beside the deck it is the nearest outer lane; above the horizon, the lane whose
   * foot is nearest.
   */
  laneAt(x: number, y: number): number {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const eye = this.camera.position;
    this.v
      .set((x / w) * 2 - 1, 1 - (y / h) * 2, 0.5)
      .unproject(this.camera)
      .sub(eye);
    if (this.v.y < -1e-4) {
      const worldX = eye.x + this.v.x * (-eye.y / this.v.y);
      return Math.min(this.lanes - 1, Math.max(0, Math.round(worldX / LANE_W + (this.lanes - 1) / 2)));
    }
    let best = 0;
    this.padScreenPositions().forEach((p, i, all) => {
      if (Math.abs(p.x - x) < Math.abs(all[best].x - x)) best = i;
    });
    return best;
  }

  setLaneDown(lane: number, down: boolean) {
    if (down) this.padLight[lane] = 1;
  }

  private onEvent(e: GameEvent) {
    switch (e.type) {
      case 'hit':
        this.flashLife[e.lane] = 1;
        this.burst(e.lane, e.grade === 'perfect' ? 18 : 10);
        break;
      case 'miss':
        this.shake = Math.max(this.shake, 0.4);
        break;
      case 'release':
        this.flashLife[e.lane] = 1;
        this.burst(e.lane, e.grade === 'perfect' ? 22 : 12, WHITE);
        break;
      case 'release-miss':
        this.shake = Math.max(this.shake, 0.3);
        break;
      case 'phrase-complete':
        for (let i = 0; i < this.lanes; i++) this.burst(i, 6, OVERDRIVE_COLOR);
        break;
      case 'overdrive-start':
        this.pulse = 1.5;
        this.flare = 1;
        break;
    }
  }

  private burst(lane: number, count: number, color?: THREE.Color) {
    const col = color ?? this.laneColors[lane];
    const x = this.laneX(lane);
    for (let k = 0; k < count; k++) {
      const i = this.pNext;
      this.pNext = (this.pNext + 1) % MAX_PARTICLES;
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3;
      this.pPos[i * 3] = x + (Math.random() - 0.5) * 0.5;
      this.pPos[i * 3 + 1] = 0.15;
      this.pPos[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
      this.pVel[i * 3] = Math.cos(a) * sp * 0.5;
      this.pVel[i * 3 + 1] = 2 + Math.random() * 3.5;
      this.pVel[i * 3 + 2] = Math.sin(a) * sp * 0.3;
      this.pCol[i * 3] = col.r;
      this.pCol[i * 3 + 1] = col.g;
      this.pCol[i * 3 + 2] = col.b;
      this.pLife[i] = 0.5 + Math.random() * 0.35;
    }
  }

  /**
   * Motes of light rising from the rails, like dust in lantern light: small solid sparks with a
   * white-hot core and a tight halo, some with a glint, swaying a little and sparkling as they
   * fade. `color` is null when none are due; the ones already afloat still live out their time.
   */
  private floatMotes(dt: number, now: number, color: THREE.Color | null) {
    if (color) {
      this.moteDebt += dt * MOTE_RATE;
      while (this.moteDebt >= 1) {
        this.moteDebt -= 1;
        const i = this.moteNext;
        this.moteNext = (this.moteNext + 1) % MAX_MOTES;
        const k = i * 3;
        const side = Math.random() < 0.5 ? -1 : 1;
        // They keep close to the rail they rise from.
        this.mPos[k] = side * (this.width / 2 - 0.05 + Math.random() * 0.38);
        this.mPos[k + 1] = Math.random() * 0.25;
        // More of them toward the player, where the rails are widest on screen.
        this.mPos[k + 2] = PAST - Math.pow(Math.random(), 1.5) * LENGTH * 0.8;
        this.mVel[k] = side * Math.random() * 0.08;
        this.mVel[k + 1] = 0.1 + Math.random() * 0.34;
        this.mVel[k + 2] = (Math.random() - 0.5) * 0.3;
        // Each a slightly different gold (or blue), from deep to pale.
        const pale = Math.random() * 0.35;
        this.mCol[k] = color.r + (1 - color.r) * pale;
        this.mCol[k + 1] = color.g * (0.82 + Math.random() * 0.18) + (1 - color.g) * pale;
        this.mCol[k + 2] = color.b * (0.6 + Math.random() * 0.4) + (1 - color.b) * pale;
        // The point is three times its core across: the rest is halo and glint.
        this.mSize[i] = 0.09 + Math.random() * 0.1;
        this.mStar[i] = Math.random() < 0.3 ? 1 : 0;
        this.mPeak[i] = 1;
        this.mSpan[i] = 1.0 + Math.random() * 1.4;
        this.mLife[i] = this.mSpan[i];
      }
    } else this.moteDebt = 0;

    let alive = false;
    for (let i = 0; i < MAX_MOTES; i++) {
      if (this.mLife[i] <= 0) continue;
      alive = true;
      this.mLife[i] -= dt;
      const k = i * 3;
      // They sway a little as they rise.
      this.mPos[k] += (this.mVel[k] + Math.sin(now / 420 + i * 2.1) * 0.07) * dt;
      this.mPos[k + 1] += this.mVel[k + 1] * dt;
      this.mPos[k + 2] += this.mVel[k + 2] * dt;
      const age = 1 - Math.max(0, this.mLife[i]) / this.mSpan[i];
      // In over the first fifth, out over the rest, with a slow twinkle.
      const fade = Math.min(1, age / 0.12) * Math.min(1, (1 - age) / 0.35);
      // A quick sparkle on top of the fade.
      this.mAlpha[i] = this.mLife[i] > 0 ? this.mPeak[i] * fade * (0.7 + 0.3 * Math.sin(now / 85 + i * 1.7)) : 0;
    }
    this.motes.visible = alive;
    if (!alive) return;
    const g = this.motes.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aStar.needsUpdate = true;
  }
  /**
   * Renders the frame for song time `t`. `beatPulse` (0..1) lets the music drive the track glow.
   * `now` is the clock its own motion (particles, glows, fades) runs on, in ms: the real one, or a
   * video's, which steps a frame at a time however fast the frames are made.
   */
  render(t: number, session: GameSession, beatPulse = 0, now = performance.now()) {
    if (!this.compiled) return;
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const speed = this.speed;
    const horizon = LENGTH / speed;
    const notes = this.chart.notes;

    // Track uniforms
    const odTarget = session.overdriveActive ? 1 : 0;
    const u = this.trackMat.uniforms;
    u.uOverdrive.value += (odTarget - u.uOverdrive.value) * Math.min(1, dt * 6);
    u.uScroll.value = (t * speed * 0.5) % 2;
    u.uTime.value = (now / 1000) % 1000;
    // The facets move with the notes; 16 units is a whole number of their repeats.
    u.uTravel.value = (t * speed) % 16;
    const fu = this.fogMat.uniforms;
    // A hit rolls in fast, with a flash, and clears more slowly.
    if (this.fog > 0.5 && fu.uLevel.value < 0.05) fu.uFlash.value = 1;
    fu.uFlash.value = Math.max(0, fu.uFlash.value - dt * 2.5);
    fu.uLevel.value += (this.fog - fu.uLevel.value) * Math.min(1, dt * (this.fog > fu.uLevel.value ? 9 : 3));
    fu.uTime.value = u.uTime.value;
    if (this.fogMesh) this.fogMesh.visible = fu.uLevel.value > 0.01;
    this.pulse = Math.max(0, this.pulse - dt * 2);
    // The music's push (beats and bass) is eased before it reaches the deck: it rises over a few
    // hundredths of a second and settles over a few tenths, so the light swells and ebbs with the
    // song instead of flickering with every jump in the bass level.
    const ease = beatPulse > this.beatGlow ? 22 : 5;
    this.beatGlow += (beatPulse - this.beatGlow) * (1 - Math.exp(-dt * ease));
    u.uPulse.value = this.pulse + this.beatGlow * 0.6;
    this.flare = Math.max(0, this.flare - dt * 1.1);
    // A streak long enough for the top multiplier turns the rails a light, glowing gold and sets
    // motes of light floating up from them. Overdrive takes the rails over in its own blue, and
    // its motes are blue.
    const fullStreak = multiplierFor(session.streak) >= MAX_MULTIPLIER;
    u.uGold.value += ((fullStreak ? 1 : 0) - u.uGold.value) * Math.min(1, dt * 5);
    this.lip.color.copy(RAIL).lerp(STREAK_GOLD, u.uGold.value).lerp(OVERDRIVE_TILE, u.uOverdrive.value);
    const glowLevel = Math.max(u.uGold.value * 0.85, u.uOverdrive.value);
    this.floatMotes(dt, now, session.overdriveActive ? OVERDRIVE_TILE : fullStreak ? MOTE_GOLD : null);
    for (const mat of this.glowMats) {
      mat.uniforms.uTime.value = now / 1000;
      mat.uniforms.uLevel.value = glowLevel;
      mat.uniforms.uBlue.value = u.uOverdrive.value;
      mat.uniforms.uFlare.value = this.flare;
    }
    this.glow.visible = glowLevel > 0.01;

    // Camera shake on misses
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.root.position.x = (Math.random() - 0.5) * 0.06 * this.shake;

    // Beat lines
    const beats = this.chart.beats;
    while (this.firstBeat < beats.length && beats[this.firstBeat] < t - 0.2) this.firstBeat++;
    let li = 0;
    let di = 0;
    const downs = this.chart.downbeats;
    while (di < downs.length && downs[di] < this.firstBeat) di++;
    for (let b = this.firstBeat; b < beats.length && li < MAX_LINES; b++) {
      const dz = (beats[b] - t) * speed;
      if (dz > LENGTH) break;
      const isBar = di < downs.length && downs[di] === b;
      if (isBar) di++;
      this.q.copy(this.flat);
      this.v.set(0, 0, -dz);
      // A line draws itself in at the far end instead of snapping onto the deck.
      this.s.set(this.width, (isBar ? 0.05 : 0.02) * arrived(LENGTH - dz), 1);
      this.m.compose(this.v, this.q, this.s);
      this.lines.setMatrixAt(li++, this.m);
    }
    this.lines.count = li;
    this.lines.instanceMatrix.needsUpdate = true;

    // Notes
    while (this.firstNote < notes.length) {
      const n = notes[this.firstNote];
      if (n.t + n.dur >= t - 0.4) break;
      this.firstNote++;
    }
    let gi = 0;
    let ti = 0;
    let ni = 0;
    // How far overdrive has come on (it eases in and out with the lane's own glow).
    const drive = this.trackMat.uniforms.uOverdrive.value as number;
    const list = this.gemList;
    this.q.identity();
    for (let i = this.firstNote; i < notes.length; i++) {
      const n = notes[i];
      if (n.t - t > horizon) break;
      const x = this.laneX(n.lane);
      const hit = session.isHit(i);
      const missed = session.isMissed(i);
      const held = hit && session.holding[n.lane] === i;
      // A tile that holds overdrive is silver; in overdrive every tile turns light blue.
      const kind = n.phrase >= 0 && !session.isPhraseFailed(n.phrase) ? PHRASE_KIND : n.lane;

      if (n.dur > 0) {
        const startZ = held ? 0 : -(n.t - t) * speed;
        const end = -(n.t + n.dur - t) * speed;
        const endZ = Math.max(-LENGTH, end);
        const len = startZ - endZ;
        // A held one burns brighter; a missed one is all but out.
        const bright = missed || (n.release && session.isReleaseMissed(i)) ? MISSED_TINT : held ? 1.2 + 0.12 * Math.sin(now / 90) : 1;
        if (len > 0.01 && (!hit || held)) {
          if (n.release && ni < MAX_TAILS) {
            // A hold to be let go on time: a neck running to the arrow where it is let go.
            this.v.set(x, 0.011, startZ);
            this.s.set(NECK_QUAD, 1, len);
            this.m.compose(this.v, this.q, this.s);
            this.necks.setMatrixAt(ni, this.m);
            this.neckData.set([kind, drive, bright, len], ni * 4);
            this.neckEnd[ni * 2] = startZ - end;
            this.neckEnd[ni * 2 + 1] = held ? 1 : 0;
            ni++;
          } else if (!n.release && ti < MAX_TAILS) {
            this.v.set(x, 0.012, startZ);
            this.s.set(ROD_W * ROD_SPAN, 1, len);
            this.m.compose(this.v, this.q, this.s);
            this.tails.setMatrixAt(ti, this.m);
            this.tailData.set([kind, drive, bright, held ? 1 : kind === PHRASE_KIND ? 0.6 : 0.4], ti * 4);
            ti++;
          }
        }
        if (held) this.padLight[n.lane] = Math.max(this.padLight[n.lane], 0.8);
      }

      if (hit || gi >= MAX_GEMS) continue;
      const z = -(n.t - t) * speed;
      if (z > PAST) continue;
      // A tile that got past the strike line shrinks away before the deck ends.
      const gone = z > 0.2 ? Math.max(0, 1 - (z - 0.2) / (PAST - 0.25)) : 1;
      // At the far end it grows from nothing to its size, solid all the way, so it arrives instead
      // of popping up (and never lies half see-through over the stage behind).
      const k = gi * 7;
      list[k] = z;
      list[k + 1] = x;
      list[k + 2] = gone * arrived(z + LENGTH);
      list[k + 3] = kind;
      list[k + 4] = drive;
      // In overdrive their light swells and ebbs, a wave running down the lane toward the player.
      list[k + 5] = missed ? MISSED_TINT : 1 + drive * (0.05 + 0.12 * (0.5 + 0.5 * Math.sin(now / 150 + z * 0.8)));
      list[k + 6] = n.release ? 1 : 0;
      gi++;
    }
    // The far ones first, so a nearer tile covers a further one.
    const order = this.gemOrder;
    order.length = gi;
    for (let j = 0; j < gi; j++) order[j] = j;
    order.sort((a, b) => list[a * 7] - list[b * 7]);
    for (let j = 0; j < gi; j++) {
      const k = order[j] * 7;
      const scale = list[k + 2];
      this.v.set(list[k + 1], 0, list[k]);
      this.s.set(scale, scale, scale);
      this.m.compose(this.v, this.q, this.s);
      this.gems.setMatrixAt(j, this.m);
      this.gemData.set([list[k + 3], list[k + 4], list[k + 5], list[k + 6]], j * 4);
    }
    this.gems.count = gi;
    this.tails.count = ti;
    this.gems.instanceMatrix.needsUpdate = true;
    this.gems.geometry.getAttribute('aTile').needsUpdate = true;
    this.tails.instanceMatrix.needsUpdate = true;
    this.tails.geometry.getAttribute('aRod').needsUpdate = true;
    this.necks.count = ni;
    (this.necks.material as THREE.ShaderMaterial).uniforms.uTime.value = (now / 1000) % 1000;
    this.necks.instanceMatrix.needsUpdate = true;
    this.necks.geometry.getAttribute('aNeck').needsUpdate = true;
    this.necks.geometry.getAttribute('aNeckEnd').needsUpdate = true;

    // The islands: pressed, they fill with light and stand in a column of it; struck, they flare.
    for (let i = 0; i < this.lanes; i++) {
      if (session.laneDown[i]) this.padLight[i] = Math.max(this.padLight[i], 0.55);
      this.padLight[i] = Math.max(0, this.padLight[i] - dt * 5);
      this.flashLife[i] = Math.max(0, this.flashLife[i] - dt * 4.5);
      const pressed = Math.min(1, this.padLight[i] / 0.5);
      const flash = this.flashLife[i];
      const pu = this.pads[i].material.uniforms;
      pu.uPress.value = pressed;
      pu.uFlash.value = flash;
      (u.uLight.value as number[])[i] = this.padLight[i];
      this.walls[i].material.uniforms.uLevel.value = 1.5 + 0.8 * pressed + flash;
      const column = pressed * 0.7 + flash * 0.6;
      this.pillars[i].material.uniforms.uLevel.value = column;
      this.pillars[i].visible = column > 0.005;
    }

    // Particles
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const k = i * 3;
      this.pVel[k + 1] -= 9 * dt;
      this.pPos[k] += this.pVel[k] * dt;
      this.pPos[k + 1] += this.pVel[k + 1] * dt;
      this.pPos[k + 2] += this.pVel[k + 2] * dt;
      if (this.pLife[i] <= 0) this.pPos[k + 1] = -100;
      const fade = this.pLife[i] < 0.2 ? 0.85 : 1;
      this.pCol[k] *= fade;
      this.pCol[k + 1] *= fade;
      this.pCol[k + 2] *= fade;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.geometry.attributes.color.needsUpdate = true;

    this.renderer.render(this.scene, this.camera);
  }

  /** Call after seeking backwards (restart). */
  reset() {
    this.firstNote = 0;
    this.firstBeat = 0;
  }

  dispose() {
    this.unsub?.();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
  }
}
