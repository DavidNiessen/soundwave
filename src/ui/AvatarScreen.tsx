/**
 * The player's look (docs/specs/online-play.md, 4.2), edited in place on the Online tab: the tab's
 * tiles give way to this editor while the character under the nametag wears every choice at once.
 * At every part stands that part's band member; the player chooses what they wear and the finish of
 * their instrument, tries it on at each part, and saves it to the server, where their party sees it.
 */
import { Check, Dices, Palette, RotateCcw, Undo2, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PARTS, type Part } from '../chart/types';
import type { Settings } from '../game/settings';
import { keysOf } from '../input/bindings';
import { TAB_HOLD_EVENT } from '../input/menuNav';
import { online } from '../net/client';
import type { Avatar } from '../net/protocol';
import { Hint, useActions, useHints } from './actions';
import { Dialog } from './Dialog';
import { ICON_STROKE, PART_ICON, PART_LABEL } from './icons';

/** The colours to choose from, by name (for screen readers and the name under each choice). */
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
/** What a first choice starts the other two from. */
const START: Avatar = { top: '#ff4f9a', bottom: '#1b1530', finish: '#5df2d6' };
type Slot = keyof Avatar;
const SLOTS: { id: Slot; label: string; what: string }[] = [
  { id: 'top', label: 'Top', what: 'Shirt, jacket or dress' },
  { id: 'bottom', label: 'Bottom', what: 'Trousers or skirt' },
  { id: 'finish', label: 'Instrument', what: 'The finish of their instrument' },
];
const nameOf = (color: string | undefined) => PALETTE.find(([c]) => c === color)?.[1] ?? 'Their own';
const same = (a: Avatar | null, b: Avatar | null) => JSON.stringify(a) === JSON.stringify(b);

export interface LookPreview {
  part: Part;
  look: Avatar | null;
}

/**
 * The look editor. `onPreview` gets each change (the character beside it wears it); `onClose` ends
 * the editing, after asking about changes not saved.
 */
export function LookEditor({
  part,
  settings,
  onPreview,
  onClose,
}: {
  part: Part;
  settings: Settings;
  onPreview(p: LookPreview): void;
  onClose(): void;
}) {
  const s = useSyncExternalStore(online.subscribe, online.snapshot);
  const hints = useHints(settings);
  const saved = s.avatar;
  // null: the band member's own look (nothing chosen).
  const [look, setLookState] = useState<Avatar | null>(saved);
  const [shown, setShownState] = useState(part);
  const [slot, setSlot] = useState<Slot>('top');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const dirty = !same(look, saved);

  const setLook = (l: Avatar | null) => {
    setLookState(l);
    setNote(null);
    onPreview({ part: shown, look: l });
  };
  const setShown = (p: Part) => {
    setShownState(p);
    onPreview({ part: p, look });
  };
  const pick = (color: string) => setLook({ ...(look ?? START), [slot]: color });
  const step = <T,>(list: T[], at: T, by: number) => list[(list.indexOf(at) + by + list.length) % list.length];
  const nextSlot = () =>
    setSlot(
      step(
        SLOTS,
        SLOTS.find((x) => x.id === slot)!,
        1,
      ).id,
    );
  const surprise = () => {
    const any = () => PALETTE[Math.floor(Math.random() * PALETTE.length)][0];
    setLook({ top: any(), bottom: any(), finish: any() });
  };

  const save = async () => {
    setBusy(true);
    try {
      await online.saveAvatar(look);
      setNote(look ? 'Saved. Your party sees it at your part.' : 'Saved. Your band member plays in their own look.');
      return true;
    } catch (e) {
      setNote((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const leave = () => (dirty ? setAsking(true) : onClose());
  /** A tab switch asked for while there are changes: it waits for the answer to Save your look. */
  const then = useRef<(() => void) | null>(null);
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = box.current!;
    const held = (e: Event) => {
      then.current = (e as CustomEvent<() => void>).detail;
      setAsking(true);
    };
    el.addEventListener(TAB_HOLD_EVENT, held);
    return () => el.removeEventListener(TAB_HOLD_EVENT, held);
  }, []);
  /** Done with the editor, from the question: on to the tab asked for, if one was. */
  const finish = () => {
    const go = then.current;
    then.current = null;
    onClose();
    go?.();
  };

  useActions([
    { id: 'back', label: dirty ? 'Done' : 'Back', icon: X, kbd: 'Escape', sfx: 'back', run: leave },
    { id: 'look-save', label: 'Save', icon: Check, ...keysOf('look.save'), bar: false, run: () => void save() },
    {
      id: 'look-part',
      label: 'Try it on at the next part',
      icon: PART_ICON[shown],
      ...keysOf('look.part'),
      bar: false,
      run: () => setShown(step(PARTS, shown, 1)),
    },
    { id: 'look-slot', label: 'Colour the next thing', icon: Palette, ...keysOf('look.slot'), bar: false, run: nextSlot },
    { id: 'look-random', label: 'Surprise me', icon: Dices, ...keysOf('look.random'), bar: false, run: surprise },
    { id: 'look-undo', label: 'Undo changes', icon: Undo2, ...keysOf('look.undo'), bar: false, run: () => setLook(saved) },
    { id: 'look-own', label: 'Their own look', icon: RotateCcw, ...keysOf('look.own'), bar: false, run: () => setLook(null) },
  ]);

  const current = SLOTS.find((x) => x.id === slot)!;
  const noFinish = slot === 'finish' && shown === 'vocals';
  return (
    <section className="look-editor" aria-label="Your look" ref={box} data-holds-tabs={dirty ? '' : undefined}>
      <header className="look-head">
        <h2 className="display">Your look</h2>
        <p className="hint">Dress your band member. Everyone sees it wherever you play{s.info ? `, on ${s.info.name}` : ''}.</p>
      </header>

      <div className="look-group">
        <span className="label">
          Try it on
          <Hint {...keysOf('look.part')} {...hints} />
        </span>
        <div className="choice-pair look-parts" role="radiogroup" aria-label="Try it on at">
          {PARTS.map((p) => {
            const Icon = PART_ICON[p];
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={shown === p}
                className={`choice ${shown === p ? 'on' : ''}`}
                onClick={() => setShown(p)}
              >
                <Icon strokeWidth={ICON_STROKE} aria-hidden />
                {PART_LABEL[p]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="look-group">
        {/* Back to the band member's own colours sits with the colours, so the row of actions under them fits. */}
        <div className="look-group-head">
          <span className="label">
            Colour
            <Hint {...keysOf('look.slot')} {...hints} />
          </span>
          <button type="button" className="btn small quiet" data-action="look-own" disabled={!look} onClick={() => setLook(null)}>
            <RotateCcw strokeWidth={ICON_STROKE} aria-hidden />
            Their own look
            <Hint {...keysOf('look.own')} {...hints} />
          </button>
        </div>
        <div className="look-slots" role="tablist" aria-label="What to colour">
          {SLOTS.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={slot === x.id}
              className={`look-slot ${slot === x.id ? 'on' : ''}`}
              data-autofocus={x.id === 'top' ? '' : undefined}
              onClick={() => setSlot(x.id)}
            >
              <span className={`look-chip ${look ? '' : 'own'}`} style={{ ['--swatch' as string]: look?.[x.id] }} aria-hidden />
              <span className="look-slot-text">
                <span className="look-slot-label">{x.label}</span>
                <span className="look-slot-value">{look ? nameOf(look[x.id]) : 'Their own'}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="hint look-what">{noFinish ? 'A microphone has no finish to show: try it on at another part.' : current.what}</p>
        <div className="look-swatches" role="radiogroup" aria-label={current.label}>
          {PALETTE.map(([color, name]) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={look?.[slot] === color}
              aria-label={name}
              title={name}
              className={`avatar-swatch ${look?.[slot] === color ? 'on' : ''}`}
              style={{ ['--swatch' as string]: color }}
              onClick={() => pick(color)}
            >
              {look?.[slot] === color && <Check strokeWidth={3} aria-hidden />}
            </button>
          ))}
        </div>
      </div>

      <div className="look-actions">
        <button type="button" className="btn primary" data-action="look-save" disabled={!dirty || busy} onClick={() => void save()}>
          <Check strokeWidth={ICON_STROKE} aria-hidden />
          {dirty ? 'Save' : 'Saved'}
          <Hint {...keysOf('look.save')} {...hints} />
        </button>
        <button type="button" className="btn" data-action="look-random" onClick={surprise}>
          <Dices strokeWidth={ICON_STROKE} aria-hidden />
          Surprise me
          <Hint {...keysOf('look.random')} {...hints} />
        </button>
        <button type="button" className="btn" data-action="look-undo" disabled={!dirty} onClick={() => setLook(saved)}>
          <Undo2 strokeWidth={ICON_STROKE} aria-hidden />
          Undo changes
          <Hint {...keysOf('look.undo')} {...hints} />
        </button>
      </div>
      {note && (
        <p className="hint look-note" role="status">
          {note}
        </p>
      )}

      {asking && (
        <Dialog
          title="Save your look"
          variant="card"
          closeLabel="Keep editing"
          onClose={() => {
            then.current = null;
            setAsking(false);
          }}
        >
          {(close) => (
            <div className="pause-card">
              <h2 className="display">Save your look?</h2>
              <p className="hint">You changed it and have not saved it yet.</p>
              <button type="button" className="btn primary wide" data-autofocus onClick={() => void save().then((ok) => ok && finish())}>
                Save
              </button>
              <button type="button" className="btn wide" data-sfx="back" onClick={finish}>
                Leave it as it was
              </button>
              <button type="button" className="btn wide quiet" onClick={close}>
                Keep editing
              </button>
            </div>
          )}
        </Dialog>
      )}
    </section>
  );
}
