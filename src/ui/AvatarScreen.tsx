/**
 * The player's look on the stage (docs/specs/online-play.md, 4.2): at the part they play stands
 * that part's band member, in their colours. Each choice shows at once on the stage behind the
 * screen; Keep stores it on the server, where their party sees it too.
 */
import { ArrowLeft, Check, RotateCcw } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { PARTS, type Part } from '../chart/types';
import type { Settings } from '../game/settings';
import { keysOf } from '../input/bindings';
import { online } from '../net/client';
import type { Avatar } from '../net/protocol';
import { setMenuAvatars, setMenuLook } from '../render/aurora/menuStage';
import { Hint, useActions, useHints } from './actions';
import { ICON_STROKE, PART_ICON, PART_LABEL } from './icons';

/** The colours to choose from, by name (for screen readers and the label under the row). */
const PALETTE: [string, string][] = [
  ['#f4f1ff', 'White'],
  ['#1b1530', 'Black'],
  ['#ff4f9a', 'Pink'],
  ['#ff5a72', 'Red'],
  ['#ff8a3d', 'Orange'],
  ['#ffd23d', 'Gold'],
  ['#3ddc84', 'Green'],
  ['#5df2d6', 'Mint'],
  ['#2a8cff', 'Blue'],
  ['#6b5bd6', 'Violet'],
];
const START: Avatar = { top: '#ff4f9a', bottom: '#1b1530', finish: '#5df2d6' };
const SLOTS: [keyof Avatar, string][] = [
  ['top', 'Top'],
  ['bottom', 'Trousers and skirt'],
  ['finish', 'Instrument finish'],
];

export function AvatarScreen({ part, settings, onBack }: { part: Part; settings: Settings; onBack(): void }) {
  const s = useSyncExternalStore(online.subscribe, online.snapshot);
  const hints = useHints(settings);
  const [look, setLook] = useState<Avatar>(() => s.avatar ?? START);
  const [note, setNote] = useState<string | null>(null);
  // Which part's band member shows the look: the player's own part to begin with.
  const [shown, setShown] = useState(part);
  const nextPart = () => setShown(PARTS[(PARTS.indexOf(shown) + 1) % PARTS.length]);

  // The stage behind shows the look as it is chosen, at the player's part.
  useEffect(() => setMenuAvatars({ [shown]: look }), [shown, look]);
  // …with the camera on them, until the screen is left.
  useEffect(() => {
    setMenuLook(shown);
    return () => setMenuLook(null);
  }, [shown]);

  const keep = () =>
    void online.saveAvatar(look).then(
      () => setNote('Kept. Your party sees it at your part.'),
      (e: Error) => setNote(e.message),
    );
  const reset = () =>
    void online.saveAvatar(null).then(
      () => (setLook(START), setNote('The band member plays in their own look again.')),
      (e: Error) => setNote(e.message),
    );

  useActions([
    { id: 'back', label: 'Back', icon: ArrowLeft, kbd: 'Escape', sfx: 'back', run: onBack },
    { id: 'avatar-part', label: 'Show at the next part', icon: PART_ICON[shown], ...keysOf('party.part'), bar: false, run: nextPart },
    { id: 'avatar-reset', label: 'Their own look', icon: RotateCcw, ...keysOf('party.avatarReset'), bar: false, run: reset },
    { id: 'avatar-keep', label: 'Keep this look', icon: Check, ...keysOf('party.avatarSave'), bar: false, run: keep },
  ]);

  return (
    <div className="page avatar">
      <header className="page-head">
        <h1 className="page-title">Your look</h1>
        <p className="head-count">Your look goes wherever you play{s.info ? `, on ${s.info.name}` : ''}</p>
      </header>
      <div className="avatar-body">
        <section className="ready-panel" aria-label="Your colours">
          <h2 className="label">Shown at</h2>
          <div className="part-row" role="radiogroup" aria-label="Shown at">
            {PARTS.map((p) => {
              const Icon = PART_ICON[p];
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={shown === p}
                  className={`choice part ${shown === p ? 'on' : ''}`}
                  onClick={() => setShown(p)}
                >
                  <Icon strokeWidth={ICON_STROKE} aria-hidden />
                  <span>{PART_LABEL[p]}</span>
                </button>
              );
            })}
          </div>
          {SLOTS.map(([slot, label]) => (
            <div key={slot} className="avatar-slot">
              <h2 className="label">
                {label} · {PALETTE.find(([c]) => c === look[slot])?.[1] ?? 'Own'}
              </h2>
              <div className="avatar-swatches" role="radiogroup" aria-label={label}>
                {PALETTE.map(([color, name]) => (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={look[slot] === color}
                    aria-label={name}
                    className={`avatar-swatch ${look[slot] === color ? 'on' : ''}`}
                    style={{ ['--swatch' as string]: color }}
                    onClick={() => setLook({ ...look, [slot]: color })}
                  />
                ))}
              </div>
            </div>
          ))}
          <p className="hint">
            At every part stands that part’s band member: you choose what they wear and the finish of their instrument
            {shown === 'vocals' ? ' (a microphone has none to show).' : '.'}
          </p>
          {note && (
            <p className="hint" role="status">
              {note}
            </p>
          )}
          <div className="party-row">
            <button type="button" className="btn primary" data-action="avatar-keep" onClick={keep}>
              <Hint {...keysOf('party.avatarSave')} {...hints} />
              <Check strokeWidth={ICON_STROKE} aria-hidden />
              Keep this look
            </button>
            <button type="button" className="btn" data-action="avatar-reset" onClick={reset}>
              <Hint {...keysOf('party.avatarReset')} {...hints} />
              <RotateCcw strokeWidth={ICON_STROKE} aria-hidden />
              Their own look
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
