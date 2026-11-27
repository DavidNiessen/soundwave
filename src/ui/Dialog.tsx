import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { getInputMode, usesFocus } from '../input/inputMode';
import { focusables } from '../input/menuNav';
import { useActions, type Action } from './actions';
import { ICON_STROKE } from './icons';

/** How long a dialog takes to leave, ms (matches the CSS). */
const EXIT_MS = 180;

/**
 * Runs `done` after the leave animation. Returns whether the dialog is leaving and the function
 * that starts it.
 */
export function useExit(done: () => void): [boolean, () => void] {
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(done);
  doneRef.current = done;
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const leave = useCallback(() => {
    setLeaving((was) => {
      if (!was) timer.current = window.setTimeout(() => doneRef.current(), EXIT_MS);
      return true;
    });
  }, []);
  return [leaving, leave];
}

interface Props {
  title: string;
  /** `sheet` slides up from the bottom on narrow screens and sits at the side on wide ones; `card` is centred. */
  variant?: 'sheet' | 'card';
  /** Extra classes for the overlay (`see-through` leaves the screen behind in view, `wide-card` widens a card). */
  className?: string;
  onClose(): void;
  /** Actions for the bar while the dialog is open (Close is added). */
  actions?: Action[];
  closeLabel?: string;
  /** A press outside closes it (true); false for a question a stray click must not answer. */
  outsideCloses?: boolean;
  children: ReactNode | ((close: () => void) => ReactNode);
}

/**
 * A modal dialog: it takes focus and directional navigation while open, keeps Tab inside, closes
 * on Esc, the controller's back button or a press outside, and hands focus back where it was.
 */
export function Dialog({
  title,
  variant = 'sheet',
  className = '',
  onClose,
  actions = [],
  closeLabel = 'Close',
  outsideCloses = true,
  children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [leaving, close] = useExit(onClose);

  useActions([...actions, { id: 'close', label: closeLabel, icon: X, kbd: 'Escape', sfx: 'back', run: close }]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const box = ref.current!;
    const list = focusables(box);
    const first = usesFocus(getInputMode()) ? (list.find((el) => el.hasAttribute('data-autofocus')) ?? list[0]) : undefined;
    (first ?? box.querySelector<HTMLElement>('.dialog')!).focus({ preventScroll: true });
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const all = Array.from(
        box.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => el.offsetParent !== null);
      if (!all.length) return e.preventDefault();
      const i = all.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? all.length - 1 : i - 1) : i === all.length - 1 ? 0 : i + 1;
      e.preventDefault();
      all[next].focus();
    };
    box.addEventListener('keydown', trap);
    return () => {
      box.removeEventListener('keydown', trap);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`overlay ${variant} ${className} ${leaving ? 'leaving' : ''}`}
      data-modal
      onPointerDown={(e) => outsideCloses && e.target === e.currentTarget && close()}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} data-ring="none">
        <button type="button" className="icon-btn dialog-close" data-sfx="back" data-nav-skip aria-label={closeLabel} onClick={close}>
          <X strokeWidth={ICON_STROKE} aria-hidden />
        </button>
        {typeof children === 'function' ? children(close) : children}
      </div>
    </div>
  );
}
