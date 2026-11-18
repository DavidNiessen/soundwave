import { useEffect, useRef, useState } from 'react';
import { NAV_EVENT, type Dir } from '../input/menuNav';
import { hexToHsv, hsvToHex, hueHex, parseHex, type Hsv } from './colorMath';

/** One press of a direction moves the field's point and the hue this far (held, they repeat). */
const STEP = 0.04;
const HUE_STEP = 6;
const RECENT_KEY = 'soundwave.stage.recent-colors';
const RECENT_MAX = 8;

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === 'string' && !!parseHex(c)).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Remembers a colour picked here, for the row of recent colours. */
function remember(hex: string) {
  try {
    const list = [hex, ...loadRecent().filter((c) => c !== hex)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: no recent colours */
  }
}

/**
 * Steers a control with the menu's directions (keyboard arrows, D-pad, stick) in place of moving the
 * focus. `take` says what to do with a direction, and whether it was used: a direction it does not
 * use (at the control's edge, or across it) moves the focus on as usual, so nothing traps it.
 */
function useSteer(ref: React.RefObject<HTMLElement | null>, take: (dir: Dir) => boolean) {
  const takeRef = useRef(take);
  takeRef.current = take;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onNav = (e: Event) => {
      if (takeRef.current((e as CustomEvent<{ dir: Dir }>).detail.dir)) e.preventDefault();
    };
    el.addEventListener(NAV_EVENT, onNav);
    return () => el.removeEventListener(NAV_EVENT, onNav);
  }, [ref]);
}

/** Follows a pointer held down on `el` from the press until it lets go, with its spot as 0..1 across and down. */
function drag(e: React.PointerEvent<HTMLElement>, at: (x: number, y: number) => void) {
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const r = el.getBoundingClientRect();
  const move = (ev: PointerEvent | React.PointerEvent) =>
    at(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
  move(e);
  const onMove = (ev: PointerEvent) => move(ev);
  const end = () => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', end);
    el.removeEventListener('pointercancel', end);
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

interface Props {
  value: string;
  /** Called as the colour changes (at most once a frame while it is dragged). */
  onChange(hex: string): void;
  /** Colours to offer at a press, besides the recent ones. */
  swatches?: string[];
  label: string;
}

/**
 * The game's own colour picker: a field of saturation (across) and brightness (up), a hue bar, the
 * colour as hex to read or type, and the colours used lately. A pointer drags on the field and the
 * bar; the keyboard's arrows and a controller's D-pad or stick move them in small steps (held, they
 * repeat), and at an edge go on to the next control. Every change shows at once.
 */
export function ColorPicker({ value, onChange, swatches = [], label }: Props) {
  // The picker keeps its own hue and saturation: a grey or black colour has none, and the point
  // would jump about if they were read back from the hex.
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const shown = hsvToHex(hsv);
  /** Colours this picker sent lately: they come back as `value` a frame or so later, and are not news. */
  const sent = useRef<string[]>([]);
  const own = (hex: string) => {
    sent.current = [hex, ...sent.current].slice(0, 12);
  };
  useEffect(() => {
    // Only a colour from elsewhere (a ready colour, Random colours, Undo) moves the picker.
    const v = value.toLowerCase();
    if (!sent.current.includes(v)) setHsv(hexToHsv(v));
  }, [value]);
  const [text, setText] = useState(shown);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!typing) setText(shown);
  }, [shown, typing]);
  const [recent, setRecent] = useState(loadRecent);

  // Changes reach the stage once a frame at most, however fast the pointer moves.
  const pending = useRef<string | null>(null);
  const frame = useRef(0);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const send = (hex: string) => {
    pending.current = hex;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pending.current) {
        own(pending.current);
        changeRef.current(pending.current);
      }
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  // What was picked is remembered once the picker closes.
  const last = useRef(value);
  last.current = shown;
  useEffect(() => () => remember(last.current), []);

  const set = (next: Hsv) => {
    setHsv(next);
    send(hsvToHex(next));
  };
  const pick = (hex: string) => {
    setHsv(hexToHsv(hex));
    own(hex);
    changeRef.current(hex);
    remember(hex);
    setRecent(loadRecent());
  };

  const field = useRef<HTMLDivElement>(null);
  const hue = useRef<HTMLDivElement>(null);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  useSteer(field, (dir) => {
    const { s, v } = hsv;
    if (dir === 'left' && s > 0) return (set({ ...hsv, s: clamp(s - STEP) }), true);
    if (dir === 'right' && s < 1) return (set({ ...hsv, s: clamp(s + STEP) }), true);
    if (dir === 'up' && v < 1) return (set({ ...hsv, v: clamp(v + STEP) }), true);
    if (dir === 'down' && v > 0) return (set({ ...hsv, v: clamp(v - STEP) }), true);
    return false;
  });
  useSteer(hue, (dir) => {
    if (dir !== 'left' && dir !== 'right') return false;
    set({ ...hsv, h: (hsv.h + (dir === 'right' ? HUE_STEP : -HUE_STEP) + 360) % 360 });
    return true;
  });

  const typed = parseHex(text);
  return (
    <div className="color-picker" role="group" aria-label={`${label}: pick a colour`}>
      <div
        ref={field}
        className="cp-field"
        tabIndex={0}
        role="slider"
        aria-label={`${label}: saturation and brightness`}
        aria-valuetext={`saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        data-sfx="none"
        style={{ ['--hue' as string]: hueHex(hsv.h) }}
        onPointerDown={(e) => drag(e, (x, y) => set({ ...hsv, s: x, v: 1 - y }))}
      >
        <span className="cp-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: shown }} />
      </div>
      <div
        ref={hue}
        className="cp-hue"
        tabIndex={0}
        role="slider"
        aria-label={`${label}: hue`}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        data-sfx="none"
        onPointerDown={(e) => drag(e, (x) => set({ ...hsv, h: Math.min(359.9, x * 360) }))}
      >
        <span className="cp-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, background: hueHex(hsv.h) }} />
      </div>
      <div className="cp-row">
        <span className="cp-preview" style={{ background: shown }} aria-hidden />
        <label className="cp-hex">
          <span className="cp-hash" aria-hidden>
            #
          </span>
          <input
            type="text"
            value={text.replace(/^#/, '')}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            aria-label={`${label}: hex colour`}
            aria-invalid={!typed}
            onFocus={() => setTyping(true)}
            onBlur={() => {
              setTyping(false);
              if (typed) pick(typed);
              else setText(shown);
            }}
            onChange={(e) => {
              setText(e.target.value);
              const hex = parseHex(e.target.value);
              // A full colour shows at once; three digits wait until the field is left.
              if (hex && e.target.value.replace(/^#/, '').length === 6) {
                setHsv(hexToHsv(hex));
                own(hex);
                changeRef.current(hex);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && typed) {
                e.preventDefault();
                pick(typed);
              }
            }}
          />
        </label>
      </div>
      {(recent.length > 0 || swatches.length > 0) && (
        <div className="cp-swatches">
          {[...recent, ...swatches.filter((c) => !recent.includes(c))].slice(0, 14).map((hex) => (
            <button
              key={hex}
              type="button"
              className={`color-dot ${hex === shown ? 'on' : ''}`}
              style={{ background: hex }}
              aria-label={hex}
              onClick={() => pick(hex)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
