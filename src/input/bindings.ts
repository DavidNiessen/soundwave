/**
 * Every shortcut in the game that the player can change: what it does, where, and the key (with
 * Ctrl, Alt or Shift where it needs them), controller button and mouse button it answers to.
 *
 * The defaults live here; the player's changes are stored in the settings (`bindings`) and laid
 * over them. Screens, the action bar, menu navigation, the editor and the song all ask this module
 * instead of naming keys themselves, so a change in Settings reaches all of them.
 *
 * Not in here, and fixed: moving with the arrow keys, D-pad and stick; confirm and back on a
 * controller (they follow its button layout); Esc, which always backs out of a screen and always
 * pauses a song; the lanes and overdrive (their own settings); and the on-screen keyboard.
 */
import type { PadInput } from './pads';

/** Where a shortcut works. */
export type Area = 'menus' | 'home' | 'library' | 'lobby' | 'results' | 'party' | 'boards' | 'settings' | 'song' | 'replay' | 'editor';

export const AREAS: { id: Area; label: string }[] = [
  { id: 'menus', label: 'Every menu' },
  { id: 'home', label: 'Main menu' },
  { id: 'library', label: 'Music library' },
  { id: 'lobby', label: 'Before a song' },
  { id: 'results', label: 'After a song' },
  { id: 'party', label: 'Playing together' },
  { id: 'boards', label: 'Leaderboards' },
  { id: 'settings', label: 'Settings' },
  { id: 'song', label: 'Playing a song' },
  { id: 'replay', label: 'Watching a replay' },
  { id: 'editor', label: 'Track editor' },
];

/** The mouse's middle, back and forward buttons (the left and right ones are for pointing). */
export type MouseInput = 'm1' | 'm3' | 'm4';
export const MOUSE_NAMES: Record<MouseInput, string> = { m1: 'Middle button', m3: 'Back button', m4: 'Forward button' };
/** The mouse button an event is, when it is one a shortcut can use. */
export const mouseInput = (button: number): MouseInput | null => (button === 1 ? 'm1' : button === 3 ? 'm3' : button === 4 ? 'm4' : null);

export interface Command {
  id: string;
  area: Area;
  label: string;
  /** Default key: a `KeyboardEvent.code`, after any of `Ctrl+`, `Alt+`, `Shift+` (in that order). */
  key?: string;
  /** A second default key, kept until the player binds one of their own (Backspace beside Delete). */
  key2?: string;
  pad?: PadInput;
  mouse?: MouseInput;
  /** The key cannot be changed (Esc): only the controller and mouse buttons can. */
  fixedKey?: boolean;
  /** Nor the controller button: it follows the controller's own layout (back is B, or A on a Switch). */
  fixedPad?: boolean;
}

const cmd = (area: Area, list: Omit<Command, 'area'>[]): Command[] => list.map((c) => ({ ...c, area }));

export const COMMANDS: Command[] = [
  ...cmd('menus', [
    { id: 'menus.back', label: 'Back', key: 'Escape', fixedKey: true, fixedPad: true, mouse: 'm3' },
    { id: 'menus.tabPrev', label: 'Previous tab', key: 'KeyQ', pad: 'b4' },
    { id: 'menus.tabNext', label: 'Next tab', key: 'KeyE', pad: 'b5' },
  ]),
  ...cmd('home', [
    { id: 'home.settings', label: 'Settings', key: 'KeyS', pad: 'b9' },
    { id: 'home.add', label: 'Add songs', key: 'KeyA', pad: 'b3' },
    { id: 'home.new', label: 'New track', key: 'KeyN', pad: 'b3' },
    { id: 'home.search', label: 'Search tracks', key: 'Slash' },
    { id: 'home.update', label: 'Update the game', key: 'KeyU' },
    { id: 'home.install', label: 'Get the app', key: 'KeyI' },
    { id: 'home.together', label: 'Online tab', key: 'KeyT', pad: 'b8' },
    { id: 'home.replayOptions', label: 'Replay options', key: 'KeyO', pad: 'b2', mouse: 'm1' },
    { id: 'home.replayKeep', label: 'Keep a replay', key: 'KeyK' },
    { id: 'home.replayDelete', label: 'Delete a replay', key: 'Delete', key2: 'Backspace' },
    { id: 'home.replayExport', label: 'Export a replay’s video', key: 'KeyV' },
  ]),
  ...cmd('library', [
    { id: 'library.options', label: 'Song options', key: 'KeyO', pad: 'b2', mouse: 'm1' },
    { id: 'library.select', label: 'Select a song', key: 'KeyX', pad: 'b3' },
    { id: 'library.details', label: 'Song details', key: 'KeyD' },
    { id: 'library.search', label: 'Search', key: 'Slash' },
    { id: 'library.sort', label: 'Sort', key: 'KeyS', pad: 'b7' },
    { id: 'library.add', label: 'Add songs', key: 'KeyA', pad: 'b8' },
    { id: 'library.ready', label: 'Ready up', key: 'KeyR', pad: 'b9' },
  ]),
  ...cmd('lobby', [
    { id: 'lobby.part', label: 'Next part', pad: 'b3' },
    { id: 'lobby.difficulty', label: 'Next difficulty', pad: 'b2' },
    { id: 'lobby.part1', label: 'Vocals', key: 'Digit1' },
    { id: 'lobby.part2', label: 'Lead', key: 'Digit2' },
    { id: 'lobby.part3', label: 'Bass', key: 'Digit3' },
    { id: 'lobby.part4', label: 'Drums', key: 'Digit4' },
  ]),
  ...cmd('results', [
    { id: 'results.retry', label: 'Play again', key: 'KeyR', pad: 'b3' },
    { id: 'results.part', label: 'Next song: next part', key: 'KeyP', pad: 'b2' },
    { id: 'results.part1', label: 'Next song: vocals', key: 'Digit1' },
    { id: 'results.part2', label: 'Next song: lead', key: 'Digit2' },
    { id: 'results.part3', label: 'Next song: bass', key: 'Digit3' },
    { id: 'results.part4', label: 'Next song: drums', key: 'Digit4' },
  ]),
  ...cmd('party', [
    { id: 'party.create', label: 'Start a party', key: 'KeyC', pad: 'b3' },
    { id: 'party.join', label: 'Join a party', key: 'KeyJ', pad: 'b2' },
    { id: 'party.signOut', label: 'Sign out', key: 'KeyO' },
    { id: 'party.export', label: 'Save my data from the server', key: 'KeyD' },
    { id: 'party.ready', label: 'Ready, or not', key: 'KeyR', pad: 'b9' },
    { id: 'party.pickSongs', label: 'Pick the party’s songs', key: 'KeyU', pad: 'b8' },
    { id: 'party.part', label: 'Next part', key: 'KeyP', pad: 'b3' },
    { id: 'party.difficulty', label: 'Next difficulty', key: 'KeyF', pad: 'b2' },
    { id: 'party.next', label: 'Next song', key: 'KeyN', pad: 'b9' },
    { id: 'party.hold', label: 'Hold the countdown to the next song', key: 'Space' },
    { id: 'party.lobby', label: 'Back to the party lobby', key: 'KeyB', pad: 'b8' },
    { id: 'party.leave', label: 'Leave the party', key: 'KeyL' },
    { id: 'party.boards', label: 'Leaderboards', key: 'KeyG', pad: 'b10' },
    { id: 'party.songs', label: 'Shared songs', key: 'KeyH' },
    { id: 'party.invite', label: 'Invite a friend', key: 'KeyI' },
    { id: 'party.admin', label: 'Run the server', key: 'KeyM' },
    { id: 'party.versus', label: 'Play Versus', key: 'Digit1' },
    { id: 'party.showdown', label: 'Play a Showdown', key: 'Digit2' },
    { id: 'party.changeMode', label: 'Pick another mode', key: 'KeyX' },
    { id: 'party.hits', label: 'Showdown hits on or off', key: 'KeyA' },
    { id: 'party.onePart', label: 'Showdown on one part, or any', key: 'KeyE' },
    { id: 'party.rotation', label: 'Showdown on the server’s rotation, or my set', key: 'KeyW' },
    { id: 'party.cheer', label: 'Cheer the players on', key: 'KeyY' },
    { id: 'party.private', label: 'Private party, or open to friends on Discord', key: 'KeyT' },
    { id: 'party.avatar', label: 'Your look on the stage', key: 'KeyV' },
    { id: 'party.avatarSave', label: 'Keep this look', key: 'KeyK' },
    { id: 'party.avatarReset', label: 'Use the band member’s own look', key: 'KeyZ' },
  ]),
  // The parts are the tab buttons (Q and E, the shoulder buttons), as the tabs of any menu.
  ...cmd('boards', [
    { id: 'boards.prevSong', label: 'Previous song', key: 'Comma', pad: 'b6' },
    { id: 'boards.nextSong', label: 'Next song', key: 'Period', pad: 'b7' },
    { id: 'boards.difficulty', label: 'Next difficulty', key: 'KeyF', pad: 'b2' },
    { id: 'boards.week', label: 'This week, or all time', key: 'KeyW', pad: 'b3' },
    { id: 'boards.replays', label: 'Song boards, or shared replays', key: 'KeyR', pad: 'b8' },
  ]),
  ...cmd('settings', [{ id: 'settings.reset', label: 'Restore defaults', key: 'KeyR', pad: 'b3' }]),
  ...cmd('song', [{ id: 'song.pause', label: 'Pause', key: 'KeyP', pad: 'b9' }]),
  // The speed is changed with the tab buttons (Q and E, the shoulder buttons).
  ...cmd('replay', [
    { id: 'replay.play', label: 'Play or pause', key: 'Space', pad: 'b3' },
    { id: 'replay.back', label: 'Back 10 seconds', key: 'KeyJ', pad: 'b6' },
    { id: 'replay.forward', label: 'Forward 10 seconds', key: 'KeyL', pad: 'b7' },
    { id: 'replay.restart', label: 'From the start', key: 'Home', pad: 'b8' },
    { id: 'replay.controls', label: 'Show or hide the controls', key: 'KeyH', pad: 'b2' },
    { id: 'replay.export', label: 'Export a video', key: 'KeyV' },
  ]),
  ...cmd('editor', [
    { id: 'editor.play', label: 'Play or pause', key: 'Space', pad: 'b3' },
    { id: 'editor.mark', label: 'Mark a stretch', key: 'KeyX', pad: 'b2' },
    { id: 'editor.menu', label: 'Menu', key: 'KeyM', pad: 'b9' },
    { id: 'editor.test', label: 'Test play', key: 'KeyT' },
    { id: 'editor.record', label: 'Record', key: 'KeyR' },
    { id: 'editor.phrase', label: 'Overdrive phrase', key: 'KeyO' },
    { id: 'editor.release', label: 'Let go on time', key: 'KeyH' },
    { id: 'editor.snapMode', label: 'Snap to', key: 'KeyS', pad: 'b10' },
    { id: 'editor.loop', label: 'Loop', key: 'KeyL', pad: 'b11' },
    { id: 'editor.undo', label: 'Undo', key: 'Ctrl+KeyZ', pad: 'b8' },
    { id: 'editor.redo', label: 'Redo', key: 'Ctrl+Shift+KeyZ', key2: 'Ctrl+KeyY' },
    { id: 'editor.copy', label: 'Copy', key: 'Ctrl+KeyC' },
    { id: 'editor.cut', label: 'Cut', key: 'Ctrl+KeyX' },
    { id: 'editor.paste', label: 'Paste', key: 'Ctrl+KeyV' },
    { id: 'editor.selectAll', label: 'Select all', key: 'Ctrl+KeyA' },
    { id: 'editor.repeat', label: 'Repeat the selection', key: 'Ctrl+KeyD' },
    { id: 'editor.quantize', label: 'Snap notes to the grid', key: 'Ctrl+KeyQ' },
    { id: 'editor.save', label: 'Save', key: 'Ctrl+KeyS' },
    { id: 'editor.delete', label: 'Delete', key: 'Delete', key2: 'Backspace' },
    { id: 'editor.noteUp', label: 'Move notes later', key: 'Ctrl+ArrowUp' },
    { id: 'editor.noteDown', label: 'Move notes earlier', key: 'Ctrl+ArrowDown' },
    { id: 'editor.soundNext', label: 'Next sound', key: 'Alt+ArrowUp' },
    { id: 'editor.soundPrev', label: 'Previous sound', key: 'Alt+ArrowDown' },
    { id: 'editor.barNext', label: 'Next bar', key: 'PageUp', pad: 'b7' },
    { id: 'editor.barPrev', label: 'Previous bar', key: 'PageDown', pad: 'b6' },
    { id: 'editor.start', label: 'To the start', key: 'Home' },
    { id: 'editor.end', label: 'To the end', key: 'End' },
    { id: 'editor.zoomIn', label: 'Zoom in', key: 'Equal', key2: 'NumpadAdd', pad: 'a2+' },
    { id: 'editor.zoomOut', label: 'Zoom out', key: 'Minus', key2: 'NumpadSubtract', pad: 'a2-' },
    ...[1, 2, 3, 4, 5].map((n) => ({ id: `editor.lane${n}`, label: `Note in lane ${n}`, key: `Digit${n}`, key2: `Numpad${n}` })),
  ]),
];

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

/** The player's changes: per command, the key, button or mouse button chosen (null: none). */
export type BindingOverrides = Record<string, { key?: string | null; pad?: string | null; mouse?: string | null }>;

export interface Bound {
  key: string | null;
  /** A second key that also works (only while the default key is kept). */
  key2: string | null;
  pad: string | null;
  mouse: MouseInput | null;
}

let overrides: BindingOverrides = {};

/** Takes over the player's bindings (from the settings). */
export function setBindings(next: BindingOverrides | undefined) {
  overrides = next ?? {};
}

/** What a command answers to now. */
export function bound(id: string): Bound {
  const c = BY_ID.get(id);
  const o = overrides[id] ?? {};
  const keyChanged = !c?.fixedKey && o.key !== undefined;
  return {
    key: c?.fixedKey ? (c.key ?? null) : keyChanged ? (o.key ?? null) : (c?.key ?? null),
    key2: keyChanged ? null : (c?.key2 ?? null),
    pad: o.pad !== undefined ? o.pad : (c?.pad ?? null),
    mouse: (o.mouse !== undefined ? o.mouse : (c?.mouse ?? null)) as MouseInput | null,
  };
}

/** The bindings of a command for an action in the action bar (see ui/actions). */
export function keysOf(id: string): { kbd?: string; pad?: string; mouse?: MouseInput } {
  const b = bound(id);
  return { kbd: b.key ?? undefined, pad: b.pad ?? undefined, mouse: b.mouse ?? undefined };
}

/** A key press as a binding: its code after the modifiers held (Cmd counts as Ctrl). */
export function chordOf(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string {
  const mods = [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : ''].filter(Boolean);
  return [...mods, e.code].join('+');
}

/** Whether a key press is one of a command's keys. */
export function pressed(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, id: string): boolean {
  const b = bound(id);
  const chord = chordOf(e);
  return chord === b.key || chord === b.key2;
}

/** The command of an area a key press is for, if any. */
export function commandFor(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, area: Area): string | null {
  const chord = chordOf(e);
  for (const c of COMMANDS) {
    if (c.area !== area) continue;
    const b = bound(c.id);
    if (chord === b.key || chord === b.key2) return c.id;
  }
  return null;
}

/** The command of an area a controller input is for, if any. */
export function padCommandFor(input: string, area: Area): string | null {
  for (const c of COMMANDS) if (c.area === area && bound(c.id).pad === input) return c.id;
  return null;
}

/** The command of an area a mouse button is for, if any. */
export function mouseCommandFor(button: number, area: Area): string | null {
  const input = mouseInput(button);
  if (!input) return null;
  for (const c of COMMANDS) if (c.area === area && bound(c.id).mouse === input) return c.id;
  return null;
}

/** Keys that only change what is held, never a binding by themselves. */
export const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

/** Other commands in the same area (or in every menu) that answer to the same input. */
export function clashes(id: string, kind: 'key' | 'pad' | 'mouse'): Command[] {
  const c = BY_ID.get(id);
  const mine = bound(id)[kind];
  if (!c || !mine) return [];
  const near = (o: Command) => o.area === c.area || o.area === 'menus' || (c.area === 'menus' && o.area !== 'song' && o.area !== 'editor');
  return COMMANDS.filter((o) => o.id !== id && near(o) && (bound(o.id)[kind] === mine || (kind === 'key' && bound(o.id).key2 === mine)));
}

/** Keeps only bindings of known commands, with inputs of the right shape. */
export function normalizeBindings(raw: unknown): BindingOverrides {
  const out: BindingOverrides = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!BY_ID.has(id) || !v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const entry: BindingOverrides[string] = {};
    for (const k of ['key', 'pad', 'mouse'] as const) {
      const val = o[k];
      if (val === null) entry[k] = null;
      else if (typeof val === 'string' && val.length < 40) {
        if (k === 'mouse' && !(val in MOUSE_NAMES)) continue;
        entry[k] = val;
      }
    }
    if (Object.keys(entry).length) out[id] = entry;
  }
  return out;
}
