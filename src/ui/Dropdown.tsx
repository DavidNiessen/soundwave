/**
 * A dropdown in the game's own look, in place of the browser's `<select>` (whose list the browser
 * draws itself, in the system's colours). A button shows the choice; it opens a list under it, with a
 * search over it when the list is long. Keyboard, controller and touch all reach it: the list holds
 * the focus while open (arrows or the stick move through it, Enter or A picks, Esc or B closes), and
 * a press outside it closes it.
 */
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useActions } from './actions';
import { ICON_STROKE } from './icons';

export interface DropdownOption {
  value: string;
  label: string;
  /** A second, quieter line (an artist, say). */
  hint?: string;
}

/** Longer lists than this get a search. */
const SEARCH_FROM = 8;

export function Dropdown({
  value,
  options,
  onChange,
  label,
  placeholder = 'Choose…',
  empty = 'Nothing to choose',
  className = '',
}: {
  value: string;
  options: DropdownOption[];
  onChange(value: string): void;
  /** What it chooses, for screen readers. */
  label: string;
  /** Shown while nothing is chosen. */
  placeholder?: string;
  /** Shown, and the dropdown off, when there are no options. */
  empty?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.value === value);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus({ preventScroll: true });
  };
  return (
    <div className={`dropdown ${open ? 'open' : ''} ${className}`}>
      <button
        ref={trigger}
        type="button"
        className="dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${chosen?.label ?? (options.length ? placeholder : empty)}`}
        disabled={!options.length}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`dropdown-value ${chosen ? '' : 'placeholder'}`}>
          {chosen?.label ?? (options.length ? placeholder : empty)}
          {chosen?.hint && <span className="dim"> · {chosen.hint}</span>}
        </span>
        <ChevronDown className="dropdown-chevron" strokeWidth={ICON_STROKE} aria-hidden />
      </button>
      {open && (
        <DropdownList
          anchor={trigger}
          value={value}
          options={options}
          label={label}
          onPick={(v) => {
            onChange(v);
            close();
          }}
          onClose={close}
        />
      )}
    </div>
  );
}

function DropdownList({
  anchor,
  value,
  options,
  label,
  onPick,
  onClose,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  value: string;
  options: DropdownOption[];
  label: string;
  onPick(value: string): void;
  onClose(refocus?: boolean): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const [query, setQuery] = useState('');
  // Laid over the page, under the button (a list inside a scrolling box would be cut off by it), or
  // above it where there is more room there.
  const [place] = useState(() => {
    const r = anchor.current!.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    return below >= 260 || below >= r.top
      ? { left: r.left, width: r.width, top: r.bottom + 6, bottom: undefined }
      : { left: r.left, width: r.width, top: undefined, bottom: window.innerHeight - r.top + 6 };
  });
  useLayoutEffect(() => {
    // The page moving under it closes it.
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) onClose(false);
    };
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
    // Only as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const searching = options.length > SEARCH_FROM;
  const q = query.trim().toLowerCase();
  const shown = options.filter((o) => !q || `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q));

  // Esc or B closes it, before anything of the screen under it.
  useActions([{ id: 'dropdown-close', label: 'Close', icon: X, kbd: 'Escape', sfx: 'back', bar: false, run: () => onClose() }]);

  // Opens on the choice (or the search, or the first option); a press outside closes it.
  useEffect(() => {
    const el = box.current!;
    const start =
      (searching ? el.querySelector<HTMLElement>('input') : null) ??
      el.querySelector<HTMLElement>('[aria-selected="true"]') ??
      el.querySelector<HTMLElement>('[role="option"]');
    start?.focus({ preventScroll: true });
    start?.scrollIntoView({ block: 'nearest' });
    const outside = (e: PointerEvent) => {
      if (!el.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) onClose(false);
    };
    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
    // Only as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Up and down move through the list from the keyboard; from the search, down enters it.
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(box.current!.querySelectorAll<HTMLElement>('[role="option"]'));
    if (!items.length) return;
    e.preventDefault();
    e.stopPropagation();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      at < 0
        ? e.key === 'ArrowDown'
          ? 0
          : items.length - 1
        : Math.max(0, Math.min(items.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
    items[next].focus({ preventScroll: true });
    items[next].scrollIntoView({ block: 'nearest' });
  };

  return createPortal(
    <div
      ref={box}
      className="dropdown-panel"
      data-modal=""
      onKeyDown={move}
      style={{ left: place.left, width: Math.max(place.width, 256), top: place.top, bottom: place.bottom }}
    >
      {searching && (
        <label className="dropdown-search">
          <Search strokeWidth={ICON_STROKE} aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && shown[0]) {
                e.preventDefault();
                onPick(shown[0].value);
              }
            }}
            placeholder="Find…"
            aria-label={`Find in ${label}`}
            aria-controls={id}
            spellCheck={false}
          />
        </label>
      )}
      <div className="dropdown-list" role="listbox" id={id} aria-label={label}>
        {shown.map((o) => (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={o.value === value}
            className={`dropdown-option ${o.value === value ? 'on' : ''}`}
            onClick={() => onPick(o.value)}
          >
            <span className="dropdown-option-text">
              <span className="dropdown-option-label">{o.label}</span>
              {o.hint && <span className="dropdown-option-hint">{o.hint}</span>}
            </span>
            {o.value === value && <Check strokeWidth={ICON_STROKE} aria-hidden />}
          </button>
        ))}
        {!shown.length && <p className="dropdown-none">Nothing like that.</p>}
      </div>
    </div>,
    document.body,
  );
}
