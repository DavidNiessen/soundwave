import { useEffect, useRef } from 'react';
import { getInputMode, usesFocus } from '../input/inputMode';

/** How long the ring takes to travel to a newly focused control, ms (matches --ring-ms in the CSS). */
const GLIDE = 200;

/**
 * The focus light: one ring that travels from control to control, taking each control's size and
 * corner radius as it lands. With the keyboard or a controller it follows focus; with a mouse it
 * follows the pointer, so pointing at a control looks the same as moving onto it. Touch players
 * never see it. The control it is on also carries `.is-focus` for its own lit state. A control
 * inside a larger box that reads as one control (a search field with its icon and key) has the ring
 * round that box: mark the box with `data-ring-box`.
 */
export function FocusRing() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ring = ref.current!;
    let target: HTMLElement | null = null;
    let shown = false;
    let movedAt = 0;
    let last = '';
    let raf = 0;

    /** The control under the mouse pointer. */
    let hovered: HTMLElement | null = null;
    const CONTROL = 'button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]';
    const controlAt = (from: Element | null): HTMLElement | null => {
      let el = from?.closest<HTMLElement>(CONTROL) ?? null;
      // A part of a larger control (a settings row's step arrow) lights the whole control.
      while (el && el.tabIndex < 0) {
        const outer = el.parentElement?.closest<HTMLElement>(CONTROL) ?? null;
        if (!outer) break;
        el = outer;
      }
      return el;
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') hovered = controlAt(e.target as Element | null);
    };
    const gone = () => (hovered = null);
    document.addEventListener('pointerover', over, true);
    document.documentElement.addEventListener('pointerleave', gone);

    const pick = (): HTMLElement | null => {
      const mode = getInputMode();
      // (`data-ring-off`: a screen whose controls are hidden for the moment, as a replay's are.)
      if (mode === 'touch' || document.querySelector('[data-nav-off], [data-ring-off]')) return null;
      const el = usesFocus(mode) ? (document.activeElement as HTMLElement | null) : hovered;
      if (!el || el === document.body || !el.isConnected || el.dataset.ring === 'none') return null;
      // Behind an open dialog nothing is pointed at.
      if (mode === 'mouse') {
        const modals = document.querySelectorAll('[data-modal]');
        if (modals.length && !modals[modals.length - 1].contains(el) && !el.closest('.action-bar')) return null;
        if ((el as HTMLButtonElement).disabled) return null;
      }
      return el;
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const el = pick();
      if (el !== target) {
        target?.classList.remove('is-focus');
        el?.classList.add('is-focus');
        // Arriving from nowhere the ring fades in on the spot; between controls it glides.
        // Onto a new screen it lands with the control instead of flying across the change.
        ring.classList.toggle('glide', !!el && shown && !!target?.isConnected);
        movedAt = performance.now();
        target = el;
        last = '';
      }
      if (!el) {
        if (shown) {
          shown = false;
          ring.classList.remove('on', 'glide');
        }
        return;
      }
      if (ring.classList.contains('glide') && performance.now() - movedAt > GLIDE) ring.classList.remove('glide');
      const box = el.closest<HTMLElement>('[data-ring-box]') ?? el;
      const r = box.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const style = getComputedStyle(el);
      // A control that is still fading in gets its ring once it has arrived, not around thin air.
      if (Number(style.opacity) < 0.6 && el.getAnimations?.().some((a) => a.playState === 'running')) {
        if (shown) {
          shown = false;
          ring.classList.remove('on', 'glide');
        }
        return;
      }
      const radius = getComputedStyle(box).borderTopLeftRadius;
      const next = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)},${radius}`;
      if (next !== last) {
        last = next;
        ring.style.transform = `translate(${Math.round(r.left)}px, ${Math.round(r.top)}px)`;
        ring.style.width = `${Math.round(r.width)}px`;
        ring.style.height = `${Math.round(r.height)}px`;
        ring.style.setProperty('--ring-radius', radius);
      }
      if (!shown) {
        shown = true;
        ring.classList.add('on');
      }
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('pointerover', over, true);
      document.documentElement.removeEventListener('pointerleave', gone);
      target?.classList.remove('is-focus');
    };
  }, []);
  return <div ref={ref} className="focus-ring" aria-hidden />;
}
