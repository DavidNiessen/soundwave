import { Circle, X, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getInputMode, usesFocus } from '../input/inputMode';
import { focusables } from '../input/menuNav';
import { CONFIRM_HINT, useActions } from './actions';
import { useExit } from './Dialog';
import { ICON_STROKE } from './icons';

export interface MenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  danger?: boolean;
  /** It opens something in the menu's place (a confirmation): the menu does not close first. */
  stays?: boolean;
  run(): void;
}

interface Props {
  /** The heading over the items, and the menu's name for screen readers. */
  title: string;
  label: string;
  /** Where it opens: the pointer, or beside the item for keys and controllers. */
  at: { x: number; y: number };
  items: MenuItem[];
  onClose(): void;
}

/**
 * A menu of actions at hand (right-click, a long press, the Options key or button), placed at the
 * pointer and kept on screen. Keys and controllers move through it; Esc or a press outside closes it.
 */
export function ContextMenu({ title, label, at, items, onClose }: Props) {
  const [leaving, close] = useExit(onClose);
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  // Every item closes the menu as it runs, but one that opens something in its place. Focus goes
  // back where it was first, so what the item opens hands it back there when it closes.
  const before = useRef<HTMLElement | null>(null);
  const run = (i: MenuItem) => {
    if (i.stays) return i.run();
    close();
    if (before.current?.isConnected) before.current.focus({ preventScroll: true });
    i.run();
  };

  useActions([
    { id: CONFIRM_HINT, label: 'Choose', icon: Circle, bar: false, run: () => {} },
    { id: 'close', label: 'Close', icon: X, kbd: 'Escape', sfx: 'back', run: close },
  ]);

  // Placed at the pointer, kept on screen (measured before it is first painted).
  useLayoutEffect(() => {
    const menu = ref.current?.querySelector<HTMLElement>('.ctx-menu');
    if (!menu) return;
    const r = menu.getBoundingClientRect();
    const margin = 8;
    // Above the action bar, which stays over everything at the bottom.
    const bar = document.querySelector('.action-bar')?.getBoundingClientRect();
    const bottom = bar && bar.height ? Math.min(innerHeight, bar.top) : innerHeight;
    setPlace({
      left: Math.max(margin, Math.min(at.x, innerWidth - r.width - margin)),
      top: Math.max(margin, Math.min(at.y, bottom - r.height - margin)),
    });
  }, [at.x, at.y]);

  // Focus moves in (the first item for keys and controllers), stays in, and goes back where it was.
  useEffect(() => {
    const was = document.activeElement as HTMLElement | null;
    before.current = was;
    const box = ref.current!;
    const first = usesFocus(getInputMode()) ? focusables(box)[0] : undefined;
    (first ?? box.querySelector<HTMLElement>('.ctx-menu')!).focus({ preventScroll: true });
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const all = focusables(box);
      if (!all.length) return e.preventDefault();
      const i = all.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      all[e.shiftKey ? (i <= 0 ? all.length - 1 : i - 1) : i === all.length - 1 ? 0 : i + 1].focus();
    };
    box.addEventListener('keydown', trap);
    return () => {
      box.removeEventListener('keydown', trap);
      // Only while the focus is still the menu's: what an item opened keeps it.
      const now = document.activeElement;
      if (was?.isConnected && (!now || now === document.body || box.contains(now))) was.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`overlay popover ${leaving ? 'leaving' : ''}`}
      data-modal
      onPointerDown={(e) => e.target === e.currentTarget && close()}
      onContextMenu={(e) => {
        // A right-click outside closes this menu (the browser's own never shows).
        e.preventDefault();
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="ctx-menu" role="menu" aria-label={label} tabIndex={-1} data-ring="none" style={place ?? { left: at.x, top: at.y }}>
        <p className="ctx-title">{title}</p>
        {items.map((i) => (
          <button
            key={i.id}
            type="button"
            role="menuitem"
            className={`ctx-item ${i.danger ? 'danger' : ''}`}
            disabled={i.disabled}
            onClick={() => run(i)}
          >
            <i.icon strokeWidth={ICON_STROKE} aria-hidden />
            {i.label}
          </button>
        ))}
      </div>
    </div>
  );
}
