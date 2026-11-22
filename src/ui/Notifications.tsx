import { CircleCheck, CircleX, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { useEffect, useSyncExternalStore, type CSSProperties } from 'react';
import { playSfx, type Sfx } from '../audio/sfx';
import type { Settings } from '../game/settings';
import { bound, keysOf, mouseInput, pressed } from '../input/bindings';
import { isTextField } from '../input/inputMode';
import { pads } from '../input/pads';
import { menuPulse, type MenuPulse } from '../input/rumble';
import { Hint, useHints } from './actions';
import { ICON_STROKE } from './icons';
import { dismiss, dismissNewest, hold, onRaised, snapshot, subscribe, type Tone } from './notifications';

const LOOK: Record<Tone, { icon: LucideIcon; label: string; sfx: Sfx; pulse: MenuPulse | null }> = {
  error: { icon: CircleX, label: 'Error', sfx: 'error', pulse: 'error' },
  warning: { icon: TriangleAlert, label: 'Note', sfx: 'back', pulse: 'back' },
  success: { icon: CircleCheck, label: 'Done', sfx: 'toggle-on', pulse: 'select' },
  info: { icon: Info, label: 'For your information', sfx: 'move', pulse: null },
};

/**
 * Where notifications stand: `bar` above the action bar at the foot of the menus (at the top on a
 * phone, where the foot holds the setlist and the thumbs), `top` along the top edge while a song or
 * a replay plays, clear of the highway and the score.
 */
export type NotificationPlace = 'bar' | 'top';

/**
 * The notifications on screen. Folded, only the newest is read and the older ones show as edges
 * behind it, so the stack covers no more of the screen than one; the pointer resting on it unfolds
 * it (newest nearest the edge it stands at) and holds every clock, as does the window out of sight.
 * Pressing one dismisses it; the Dismiss a notification shortcut (Z by default) dismisses the
 * newest, bringing the next forward.
 */
export function Notifications({
  settings,
  place,
  quiet,
  shortcut,
}: {
  settings: Settings;
  place: NotificationPlace;
  /** No sound or pulse (while a song plays). */
  quiet?: boolean;
  /** Whether the Dismiss notifications shortcut works (not where the keys belong to the notes). */
  shortcut?: boolean;
}) {
  const { items, held } = useSyncExternalStore(subscribe, snapshot);
  const hints = useHints(settings);

  // Each tone has its own sound, and a controller its own pulse; while a song plays they keep
  // quiet, so nothing is heard or felt that is not the music or the notes.
  useEffect(
    () =>
      onRaised((n) => {
        if (quiet) return;
        const look = LOOK[n.tone];
        playSfx(look.sfx);
        if (look.pulse) menuPulse(look.pulse);
      }),
    [quiet],
  );

  useEffect(() => {
    const seen = () => hold(document.hidden);
    document.addEventListener('visibilitychange', seen);
    return () => document.removeEventListener('visibilitychange', seen);
  }, []);

  // The shortcut works in every menu, but not in a song or the editor, where the keys belong to the notes.
  useEffect(() => {
    if (!shortcut) return;
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || isTextField(e.target) || !pressed(e, 'menus.dismiss')) return;
      if (dismissNewest()) e.preventDefault();
    };
    const mouse = (e: MouseEvent) => {
      const input = mouseInput(e.button);
      if (input && input === bound('menus.dismiss').mouse && dismissNewest()) e.preventDefault();
    };
    const release = pads.capture((e) => e.down && e.input === bound('menus.dismiss').pad && dismissNewest());
    window.addEventListener('keydown', key);
    window.addEventListener('mousedown', mouse);
    return () => {
      release();
      window.removeEventListener('keydown', key);
      window.removeEventListener('mousedown', mouse);
    };
  }, [shortcut]);

  // A notification dismissed under the pointer takes the pointer's leaving with it.
  const anyLive = items.some((n) => !n.leaving);
  useEffect(() => {
    if (!anyLive && held) hold(document.hidden);
  }, [anyLive, held]);

  const keys = keysOf('menus.dismiss');
  // The shortcut's hint stands on the newest one (the one it dismisses); a pointer or a finger
  // gets a close mark on each instead.
  const showsHint = !!shortcut && ((hints.mode === 'keyboard' && !!keys.kbd) || (hints.mode === 'pad' && !!keys.pad));
  const live = items.filter((n) => !n.leaving);
  const newest = live.at(-1)?.id;
  /** How far behind the newest each one stands while the stack is folded (0: in front). */
  const depth = (id: number) => {
    const i = live.findIndex((n) => n.id === id);
    return i < 0 ? 0 : live.length - 1 - i;
  };
  // What a screen reader says: problems at once, good news once what it is reading pauses.
  const urgent = (n: (typeof items)[number]) => n.tone === 'error' || n.tone === 'warning';
  const said = (list: typeof items) =>
    list
      .filter((n) => !n.leaving)
      .map((n) => n.text)
      .join(' ');

  const card = (n: (typeof items)[number]) => {
    const look = LOOK[n.tone];
    const Icon = look.icon;
    const d = depth(n.id);
    return (
      <button
        key={`${n.id}:${n.shown}`}
        type="button"
        className={`notice ${n.tone}${n.leaving ? ' leaving' : ''}${n.shown > 1 ? ' again' : ''}${d > 0 ? ' behind' : ''}`}
        style={{ '--life': `${n.life}ms`, '--depth': d } as CSSProperties}
        data-sfx="none"
        aria-label={`${look.label}: ${n.text}${n.count > 1 ? ` (${n.count} times)` : ''}. Dismiss.`}
        onClick={() => dismiss(n.id)}
      >
        <span className="notice-icon" aria-hidden>
          <Icon strokeWidth={ICON_STROKE} />
        </span>
        <span className="notice-text">{n.text}</span>
        {n.count > 1 && (
          <span className="notice-count" aria-hidden>
            ×{n.count}
          </span>
        )}
        <span className="notice-close" aria-hidden>
          {showsHint && n.id === newest ? <Hint {...keys} {...hints} /> : <X strokeWidth={ICON_STROKE} />}
        </span>
        <span className="notice-life" aria-hidden />
      </button>
    );
  };

  return (
    <div
      className={`notices at-${place}${held ? ' held' : ' folded'}`}
      data-nav-skip
      role="region"
      aria-label="Notifications"
      onPointerEnter={(e) => e.pointerType === 'mouse' && hold(true)}
      onPointerLeave={() => hold(document.hidden)}
    >
      {items.map(card)}
      <div className="sr-only" role="alert">
        {said(items.filter(urgent))}
      </div>
      <div className="sr-only" role="status">
        {said(items.filter((n) => !urgent(n)))}
      </div>
    </div>
  );
}
