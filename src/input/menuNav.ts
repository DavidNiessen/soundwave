/**
 * Menu navigation by direction, shared by the keyboard's arrow keys and a controller's D-pad or
 * left stick: focus moves to the nearest control that way, confirm clicks it, back acts like Esc,
 * and the shoulder buttons (Q and E on a keyboard) switch tabs.
 *
 * A control can take a direction for itself: every move is first offered to the focused element as
 * a cancelable `nav-move` event (a settings row uses left and right to change its value).
 * Containers marked `data-nav-group` remember their last focused control, so crossing from a list
 * to a side panel and back returns to the same row. `data-nav-skip` keeps a control out of
 * directional navigation (it stays reachable with Tab). The action bar is kept out that way, as a
 * legend of shortcuts, except on a screen marked `data-nav-bar` (the main menu), where its buttons
 * can be moved onto like any other, and on a screen with no controls of its own.
 */
import { bound, mouseInput, pressed } from './bindings';
import { isTextField, setInputMode } from './inputMode';
import { backInput, confirmInput, pads, type GlyphStyle } from './pads';

export type Dir = 'up' | 'down' | 'left' | 'right';

const DIRS: Record<string, Dir> = {
  b12: 'up',
  b13: 'down',
  b14: 'left',
  b15: 'right',
  'a1-': 'up',
  'a1+': 'down',
  'a0-': 'left',
  'a0+': 'right',
};
const ARROWS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const FOCUSABLE =
  'button:not([disabled]), a[href], summary, input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Sent to switch tabs (detail: -1 or 1). */
export const TAB_EVENT = 'nav-tab';
/**
 * Sent, instead of switching, to a part of a tab that must not be left without asking (marked
 * `data-holds-tabs`: the look editor with changes not saved). Its detail is the switch, to run
 * once the player has answered.
 */
export const TAB_HOLD_EVENT = 'nav-tab-hold';
/** Hands a tab switch to the part of the screen holding the tabs, if one is; returns whether one was. */
export function tabsHeld(go: () => void): boolean {
  const holder = document.querySelector('[data-holds-tabs]');
  if (!holder) return false;
  holder.dispatchEvent(new CustomEvent(TAB_HOLD_EVENT, { detail: go }));
  return true;
}
/** Sent after directional navigation moved focus (for move sounds and pulses). */
export const MOVE_EVENT = 'nav-moved';
/** Offered to the focused control before focus moves (detail: { dir }); cancel it to keep focus. */
export const NAV_EVENT = 'nav-move';
/** Sent when a controller confirms on a text field (detail: the field): the on-screen keyboard opens for it. */
export const EDIT_EVENT = 'nav-edit';

/** The topmost open dialog, or the whole document. */
export function navScope(): ParentNode {
  const modals = document.querySelectorAll('[data-modal]');
  return modals.length ? modals[modals.length - 1] : document;
}

/** Menus take directions unless a song is running (the pause menu takes them again). */
const navLive = () => !document.querySelector('[data-nav-off]');

const shown = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0 || getComputedStyle(el).visibility === 'hidden') return false;
  // What a closed <details> holds keeps its boxes but is not drawn, and cannot take focus (its
  // summary can). checkVisibility() knows; where it is missing, the closed <details> says so.
  const closed = el.closest('details:not([open])');
  if (closed && !(el.tagName === 'SUMMARY' && el.parentElement === closed)) return false;
  return typeof el.checkVisibility === 'function' ? el.checkVisibility() : true;
};

export function focusables(scope: ParentNode = navScope()): HTMLElement[] {
  const list = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    // Out of the tab order means out of directional navigation too (a row's own step arrows).
    if (el.tabIndex < 0 || el.closest('[data-nav-skip]')) return false;
    return shown(el);
  });
  if (scope !== document) return list;
  // A screen with no controls of its own (results, the set summary): the action bar's buttons take
  // the focus instead of standing outside it, so there is always something to move between. The
  // main menu asks for them as well as its own (`data-nav-bar`).
  if (list.length && !document.querySelector('[data-nav-bar]')) return list;
  return [...list, ...Array.from(document.querySelectorAll<HTMLElement>('.action-bar button:not([disabled])')).filter(shown)];
}

const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** The control nearest in a direction, favouring ones in line with the current one. */
export function nearest(from: DOMRect, dir: Dir, rects: DOMRect[]): number {
  const c = center(from);
  let best = -1;
  let bestScore = Infinity;
  rects.forEach((r, i) => {
    const p = center(r);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    // Must lie beyond the current control's edge in that direction.
    const ahead =
      dir === 'up'
        ? r.bottom <= from.top + 4
        : dir === 'down'
          ? r.top >= from.bottom - 4
          : dir === 'left'
            ? r.right <= from.left + 4
            : r.left >= from.right - 4;
    if (!ahead) return;
    const main = dir === 'up' || dir === 'down' ? Math.abs(dy) : Math.abs(dx);
    // Overlap on the cross axis counts as perfectly in line.
    const overlap =
      dir === 'up' || dir === 'down'
        ? Math.min(r.right, from.right) - Math.max(r.left, from.left)
        : Math.min(r.bottom, from.bottom) - Math.max(r.top, from.top);
    const cross = overlap > 0 ? 0 : dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    const score = main + cross * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

const groupOf = (el: Element | null) => el?.closest('[data-nav-group]') ?? null;
const remembered = new WeakMap<Element, HTMLElement>();

/** Moves focus to a control the way a directional move does, for a row that picks its own next control. */
export function focusEl(el: HTMLElement, announce = true) {
  el.focus({ preventScroll: true });
  // A window without focus (a controller used right after switching apps) moves focus silently:
  // say so, for the screens that follow the focused control.
  if (!document.hasFocus()) el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  el.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    behavior: document.documentElement.dataset.motion === 'reduced' ? 'auto' : 'smooth',
  });
  if (announce) window.dispatchEvent(new Event(MOVE_EVENT));
}

/** A scope's starting control: the one marked `data-autofocus` (or the first control inside it), else its primary one, else its first. */
function startEl(list = focusables(), scope: ParentNode = navScope()): HTMLElement | undefined {
  const marked = scope.querySelector('[data-autofocus]');
  return (
    (marked && list.find((el) => el === marked || marked.contains(el))) ?? list.find((el) => el.classList.contains('primary')) ?? list[0]
  );
}

/** Puts focus on the starting control of the screen, or of a part of it. */
export function focusStart(scope?: ParentNode) {
  const el = scope ? startEl(focusables(scope), scope) : startEl();
  if (el) focusEl(el, false);
}

/**
 * Puts focus on the screen's starting control once it has come in: a control that takes focus
 * while it is still rising into place (a main menu tile) would snap to its focused look at the end
 * of its entrance. Waits at most `maxMs`; nothing happens if focus has been put somewhere meanwhile.
 * Returns a cancel.
 */
export function focusStartSettled(maxMs = 1500): () => void {
  const el = startEl();
  if (!el) return () => {};
  const entrances: Animation[] = [];
  for (let at: Element | null = el; at && at !== document.body; at = at.parentElement)
    for (const a of at.getAnimations())
      if (a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity)) entrances.push(a);
  if (!entrances.length) {
    focusEl(el, false);
    return () => {};
  }
  let cancelled = false;
  const go = () => {
    if (cancelled) return;
    cancelled = true;
    clearTimeout(cap);
    const active = document.activeElement;
    if ((active && active !== document.body) || !el.isConnected) return;
    focusEl(el, false);
  };
  const cap = window.setTimeout(go, maxMs);
  void Promise.allSettled(entrances.map((a) => a.finished)).then(go);
  return () => {
    cancelled = true;
    clearTimeout(cap);
  };
}
/** Whether focus sits on a control of the current scope. */
function current(list: HTMLElement[]): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  return active && active !== document.body && list.includes(active) ? active : null;
}

/**
 * With no control further up or down, the panel the focus is in scrolls on that way: what lies
 * before the first control or after the last one (a legend, a note) can be read with a controller too.
 */
function scrollOn(from: HTMLElement, d: -1 | 1) {
  for (let el = from.parentElement; el && el !== document.body; el = el.parentElement) {
    if (el.scrollHeight <= el.clientHeight + 1 || !/auto|scroll/.test(getComputedStyle(el).overflowY)) continue;
    const room = d > 0 ? el.scrollHeight - el.clientHeight - el.scrollTop : el.scrollTop;
    if (room < 1) continue;
    el.scrollBy({
      top: d * Math.min(room, el.clientHeight * 0.6),
      behavior: document.documentElement.dataset.motion === 'reduced' ? 'auto' : 'smooth',
    });
    return;
  }
}

export function navMove(dir: Dir, fromPad = false) {
  if (!navLive()) return;
  const all = focusables();
  const active = current(all);
  if (!active) {
    // A control kept out of directional navigation may still hold focus (reached with Tab).
    const stray = document.activeElement as HTMLElement | null;
    const near = stray && stray !== document.body && navScope().contains(stray) ? stray.getBoundingClientRect() : null;
    const i = near
      ? nearest(
          near,
          dir,
          all.map((el) => el.getBoundingClientRect()),
        )
      : -1;
    const el = i >= 0 ? all[i] : startEl(all);
    if (el) focusEl(el);
    return;
  }
  if (!active.dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { dir }, bubbles: true, cancelable: true }))) return;
  const horizontal = dir === 'left' || dir === 'right';
  // A controller has no arrow keys for a native slider: step it here.
  if (fromPad && horizontal && active instanceof HTMLInputElement && active.type === 'range') {
    const step = Number(active.step) || 1;
    const v = Math.min(Number(active.max), Math.max(Number(active.min), Number(active.value) + (dir === 'right' ? step : -step)));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(active, String(v));
    active.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  const others = all.filter((el) => el !== active);
  const i = nearest(
    active.getBoundingClientRect(),
    dir,
    others.map((el) => el.getBoundingClientRect()),
  );
  if (i < 0) {
    if (!horizontal) scrollOn(active, dir === 'down' ? 1 : -1);
    return;
  }
  let target = others[i];
  const group = groupOf(target);
  if (group && group !== groupOf(active)) {
    const last = remembered.get(group);
    if (last && last.isConnected && others.includes(last)) target = last;
  }
  focusEl(target);
}

function confirm() {
  if (!navLive()) return;
  // A control kept out of directional navigation still counts when it holds focus (reached with Tab).
  const stray = document.activeElement as HTMLElement | null;
  const active =
    current(focusables()) ?? (stray && stray !== document.body && navScope().contains(stray) && stray.matches(FOCUSABLE) ? stray : null);
  if (!active) {
    const start = startEl();
    if (start) return focusEl(start, false);
    // A screen with nothing to focus (results): confirm is its forward action, the Enter key's.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    return;
  }
  // A text field cannot be typed into from a controller: it asks for the on-screen keyboard.
  if (isTextField(active)) {
    window.dispatchEvent(new CustomEvent(EDIT_EVENT, { detail: active }));
    return;
  }
  active.click();
}

function back() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
}

const tab = (d: -1 | 1) => window.dispatchEvent(new CustomEvent(TAB_EVENT, { detail: d }));

/** Installs menu navigation for the keyboard and controllers; returns an uninstall function. */
export function installMenuNav(style: () => GlyphStyle): () => void {
  let repeat = 0;
  let held: string | null = null;
  const stopRepeat = () => {
    clearTimeout(repeat);
    held = null;
  };
  const release = pads.capture((e) => {
    if (e.down) setInputMode('pad');
    const dir = DIRS[e.input];
    if (dir) {
      if (!e.down) {
        if (held === e.input) stopRepeat();
        return true;
      }
      stopRepeat();
      held = e.input;
      navMove(dir, true);
      const again = (delay: number) => {
        repeat = window.setTimeout(() => {
          if (held !== e.input) return;
          navMove(dir, true);
          again(110);
        }, delay);
      };
      again(380);
      return true;
    }
    const s = style();
    // The tab buttons are the player's (shoulder buttons unless they chose others).
    const prev = bound('menus.tabPrev').pad;
    const next = bound('menus.tabNext').pad;
    // Every other button is left to whoever listens underneath (the action bar's own shortcuts).
    if (e.input !== confirmInput(s) && e.input !== backInput(s) && e.input !== prev && e.input !== next) return false;
    if (!e.down) return true;
    if (e.input === confirmInput(s)) confirm();
    else if (e.input === backInput(s)) back();
    else tab(e.input === prev ? -1 : 1);
    return true;
  });

  const key = (e: KeyboardEvent) => {
    if (e.defaultPrevented || !navLive()) return;
    const target = e.target as HTMLElement | null;
    // The tab keys (Q and E unless the player chose others, with Ctrl, Alt or Shift if they did).
    if ((pressed(e, 'menus.tabPrev') || pressed(e, 'menus.tabNext')) && !e.repeat && !isTextField(target)) {
      tab(pressed(e, 'menus.tabPrev') ? -1 : 1);
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const dir = ARROWS[e.key];
    if (dir) {
      const horizontal = dir === 'left' || dir === 'right';
      // Text keeps its caret keys, a slider its own steps.
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (horizontal && (isTextField(target) || (target instanceof HTMLInputElement && target.type === 'range'))) return;
      e.preventDefault();
      navMove(dir);
    }
  };
  // A mouse button the player gave a tab switch.
  const mouse = (e: MouseEvent) => {
    const input = mouseInput(e.button);
    if (!input || !navLive()) return;
    if (input === bound('menus.tabPrev').mouse) tab(-1);
    else if (input === bound('menus.tabNext').mouse) tab(1);
  };
  const focusin = (e: FocusEvent) => {
    const el = e.target as HTMLElement | null;
    const group = groupOf(el);
    if (el && group) remembered.set(group, el);
  };
  window.addEventListener('keydown', key);
  window.addEventListener('mousedown', mouse);
  window.addEventListener('focusin', focusin);
  return () => {
    stopRepeat();
    release();
    window.removeEventListener('keydown', key);
    window.removeEventListener('mousedown', mouse);
    window.removeEventListener('focusin', focusin);
  };
}
