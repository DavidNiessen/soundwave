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
export type Area =
  | 'menus'
  | 'lists'
  | 'home'
  | 'library'
  | 'lobby'
  | 'results'
  | 'online'
  | 'party'
  | 'between'
  | 'boards'
  | 'admin'
  | 'look'
  | 'settings'
  | 'stages'
  | 'song'
  | 'replay'
  | 'editor';

export const AREAS: { id: Area; label: string }[] = [
  { id: 'menus', label: 'Every menu' },
  { id: 'lists', label: 'Songs, stages and replays' },
  { id: 'home', label: 'Main menu' },
  { id: 'library', label: 'Music library' },
  { id: 'lobby', label: 'Before a song' },
  { id: 'results', label: 'After a song' },
  { id: 'online', label: 'Online tab' },
  { id: 'party', label: 'In a party' },
  { id: 'between', label: 'Between a party’s songs' },
  { id: 'boards', label: 'Leaderboards' },
  { id: 'admin', label: 'Running a server' },
  { id: 'look', label: 'Your look' },
  { id: 'settings', label: 'Settings' },
  { id: 'stages', label: 'Stages' },
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
  /** Other areas it also works in (a party's part and difficulty, in the lobby and between songs). */
  also?: Area[];
}

const cmd = (area: Area, list: Omit<Command, 'area'>[]): Command[] => list.map((c) => ({ ...c, area }));

export const COMMANDS: Command[] = [
  ...cmd('menus', [
    { id: 'menus.back', label: 'Back', key: 'Escape', fixedKey: true, fixedPad: true, mouse: 'm3' },
    { id: 'menus.tabPrev', label: 'Previous tab', key: 'KeyQ', pad: 'b4' },
    { id: 'menus.tabNext', label: 'Next tab', key: 'KeyE', pad: 'b5' },
    // Every controller button is taken somewhere in the menus; a player can give this one theirs.
    { id: 'menus.dismiss', label: 'Dismiss a notification', key: 'KeyZ' },
  ]),
  // The same in every list of things of the player's: the music library, the Stage tab, the Replays tab.
  ...cmd('lists', [
    { id: 'lists.options', label: 'Options (the right-click menu)', key: 'KeyO', pad: 'b2', mouse: 'm1' },
    { id: 'lists.select', label: 'Select or deselect', key: 'KeyX', pad: 'b3' },
    { id: 'lists.delete', label: 'Delete', key: 'Delete', key2: 'Backspace' },
  ]),
  ...cmd('home', [
    { id: 'home.settings', label: 'Settings', key: 'KeyS', pad: 'b9' },
    { id: 'home.add', label: 'Add songs', key: 'KeyA', pad: 'b3' },
    { id: 'home.new', label: 'New track', key: 'KeyN', pad: 'b3' },
    { id: 'home.search', label: 'Search tracks', key: 'Slash' },
    { id: 'home.update', label: 'Update the game', key: 'KeyU' },
    { id: 'home.install', label: 'Get the app', key: 'KeyI' },
    // No controller button: the shoulder buttons reach the tab, and the Stage tab's New stage has this one.
    { id: 'home.together', label: 'Online tab', key: 'KeyT' },
    { id: 'home.replayKeep', label: 'Keep a replay', key: 'KeyK' },
    { id: 'home.replayExport', label: 'Export a replay’s video', key: 'KeyV', pad: 'b11' },
  ]),
  ...cmd('library', [
    { id: 'library.details', label: 'Song details', key: 'KeyD' },
    { id: 'library.search', label: 'Search', key: 'Slash' },
    { id: 'library.sort', label: 'Sort', key: 'KeyS', pad: 'b7' },
    { id: 'library.add', label: 'Add songs', key: 'KeyA', pad: 'b8' },
    { id: 'library.ready', label: 'Ready up', key: 'KeyR', pad: 'b9' },
    { id: 'library.share', label: 'Share my songs with the server, or stop', key: 'KeyH' },
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
  // The Online tab, signed in: a party to start or join, the server's boards, the player's look and account.
  ...cmd('online', [
    { id: 'party.create', label: 'Start a party or open yours (signed out: connect)', key: 'KeyC', pad: 'b3' },
    { id: 'party.join', label: 'Join a party', key: 'KeyJ', pad: 'b2' },
    { id: 'party.signOut', label: 'Your account (sign out, save your data)', key: 'KeyO' },
    { id: 'party.export', label: 'Save my data from the server (in Your account)', key: 'KeyD' },
    { id: 'party.invite', label: 'Invite a friend', key: 'KeyF', pad: 'b8' },
    { id: 'party.boards', label: 'Leaderboards', key: 'KeyG', pad: 'b10' },
    { id: 'party.avatar', label: 'Your look on the stage', key: 'KeyV' },
    { id: 'party.admin', label: 'Run the server', key: 'KeyM', pad: 'b11' },
  ]),
  // A party's room and lobby: the mode, the set, the player's part and being ready.
  ...cmd('party', [
    { id: 'party.ready', label: 'Ready, or not', key: 'KeyR', pad: 'b9' },
    { id: 'party.pickSongs', label: 'Pick the party’s songs', key: 'KeyU', pad: 'b8' },
    { id: 'party.part', label: 'Next part', key: 'KeyP', pad: 'b3', also: ['between'] },
    { id: 'party.difficulty', label: 'Next difficulty', key: 'KeyF', pad: 'b2', also: ['between'] },
    { id: 'party.calibrate', label: 'Calibrate the audio offset', key: 'KeyC' },
    { id: 'party.leave', label: 'Leave the party', key: 'KeyL', also: ['between'] },
    { id: 'party.versus', label: 'Play Versus', key: 'Digit1' },
    { id: 'party.showdown', label: 'Play a Showdown', key: 'Digit2' },
    { id: 'party.changeMode', label: 'Pick another mode', key: 'KeyX' },
    { id: 'party.everyonePicks', label: 'Versus: everyone picks songs, or the host alone', key: 'KeyK' },
    { id: 'party.hits', label: 'Showdown hits on or off', key: 'KeyA' },
    { id: 'party.onePart', label: 'Showdown on one part, or any', key: 'KeyO' },
    { id: 'party.rotation', label: 'Showdown on the server’s rotation, or my set', key: 'KeyW' },
    { id: 'party.cheer', label: 'Cheer the players on', key: 'KeyY' },
    { id: 'party.private', label: 'Private party, or open to friends on Discord', key: 'KeyT' },
    { id: 'party.discord', label: 'Show the party on my Discord status, or not', key: 'KeyH' },
  ]),
  // After each song of a party, until the next one starts.
  ...cmd('between', [
    { id: 'party.next', label: 'Next song', key: 'KeyN', pad: 'b9' },
    { id: 'party.hold', label: 'Hold the countdown to the next song', key: 'Space' },
    { id: 'party.lobby', label: 'Back to the party lobby', key: 'KeyB', pad: 'b8' },
  ]),
  // The parts are the tab buttons (Q and E, the shoulder buttons), as the tabs of any menu.
  ...cmd('boards', [
    { id: 'boards.prevSong', label: 'Previous song', key: 'Comma', pad: 'b6' },
    { id: 'boards.nextSong', label: 'Next song', key: 'Period', pad: 'b7' },
    { id: 'boards.difficulty', label: 'Next difficulty', key: 'KeyF', pad: 'b2' },
    { id: 'boards.week', label: 'This week, or all time', key: 'KeyW', pad: 'b3' },
    { id: 'boards.replays', label: 'Song boards, or shared replays', key: 'KeyR', pad: 'b8' },
  ]),
  // Your look, edited on the Online tab.
  ...cmd('look', [
    { id: 'look.part', label: 'Try it on at the next part', key: 'KeyP', pad: 'b3' },
    { id: 'look.slot', label: 'Colour the next thing (top, bottom, instrument)', key: 'KeyF', pad: 'b2' },
    { id: 'look.random', label: 'Surprise me (random colours)', key: 'KeyX', pad: 'b8' },
    { id: 'look.undo', label: 'Undo changes', key: 'KeyU' },
    { id: 'look.own', label: 'Their own look (no colours of yours)', key: 'KeyO' },
    { id: 'look.save', label: 'Save your look', key: 'KeyK', pad: 'b9' },
  ]),
  // The admin page's sections, by number, as its tiles stand.
  ...cmd('admin', [
    { id: 'admin.overview', label: 'Overview', key: 'Digit0' },
    { id: 'admin.library', label: 'Server library', key: 'Digit1' },
    { id: 'admin.players', label: 'Players', key: 'Digit2' },
    { id: 'admin.invites', label: 'Invites', key: 'Digit3' },
    { id: 'admin.rotation', label: 'Showdown rotation', key: 'Digit4' },
    { id: 'admin.log', label: 'Moderation log', key: 'Digit5' },
    { id: 'admin.reports', label: 'Reported songs', key: 'Digit6' },
    { id: 'admin.duplicates', label: 'Possible duplicates', key: 'Digit7' },
    { id: 'admin.add', label: 'Add songs to the server library', key: 'KeyA', pad: 'b3' },
    { id: 'admin.sort', label: 'Sort the server library another way', key: 'KeyS', pad: 'b2' },
  ]),
  ...cmd('settings', [{ id: 'settings.reset', label: 'Restore defaults', key: 'KeyR', pad: 'b3' }]),
  ...cmd('stages', [
    // New stage sits where the library's Add songs does; Customize is in a stage's menu for a controller.
    { id: 'stages.new', label: 'New stage', key: 'KeyN', pad: 'b8' },
    { id: 'stages.edit', label: 'Customize the stage', key: 'KeyC' },
    // Not T: that is the Online tab's, which the Stage tab keeps.
    { id: 'stages.drop', label: 'Test the drop', key: 'KeyD', pad: 'b9' },
    { id: 'stages.random', label: 'Random colours', key: 'KeyR', pad: 'b10' },
    { id: 'stages.undo', label: 'Undo', key: 'Ctrl+KeyZ' },
  ]),
  ...cmd('song', [{ id: 'song.pause', label: 'Pause', key: 'KeyP', pad: 'b9' }]),
  // The speed is changed with the tab buttons (Q and E, the shoulder buttons).
  ...cmd('replay', [
    { id: 'replay.play', label: 'Play or pause', key: 'Space', pad: 'b3' },
    { id: 'replay.back', label: 'Back 10 seconds', key: 'KeyJ', pad: 'b6' },
    { id: 'replay.forward', label: 'Forward 10 seconds', key: 'KeyL', pad: 'b7' },
    { id: 'replay.restart', label: 'From the start', key: 'Home', pad: 'b8' },
    { id: 'replay.controls', label: 'Show or hide the controls', key: 'KeyH', pad: 'b2' },
    { id: 'replay.export', label: 'Export a video', key: 'KeyV', pad: 'b11' },
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

/** Whether a command works in an area (its own, or one it also works in). */
const isIn = (c: Command, area: Area) => c.area === area || !!c.also?.includes(area);
/** The main menu's own shortcuts, which every tab keeps (the Stage tab without Settings). */
const HOME_ALWAYS = new Set(['home.together', 'home.settings', 'home.update', 'home.install']);
const always = (c: Command) => HOME_ALWAYS.has(c.id);
/**
 * The shortcuts that answer at the same time, screen by screen: two of them on one input is a clash,
 * the same input on two screens is not (C starts a party on the Online tab and calibrates in its lobby).
 * Every menu's own shortcuts work beside all of these.
 */
const SCREENS: ((c: Command) => boolean)[] = [
  (c) => always(c) || c.id === 'home.add',
  (c) => always(c) || isIn(c, 'online'),
  (c) => always(c) || c.id === 'home.search' || c.id === 'home.new',
  (c) => (always(c) && c.id !== 'home.settings') || isIn(c, 'stages') || isIn(c, 'lists'),
  (c) => always(c) || c.id.startsWith('home.replay') || isIn(c, 'lists'),
  (c) => isIn(c, 'library') || isIn(c, 'lists'),
  ...(['lobby', 'results', 'party', 'between', 'boards', 'admin', 'look', 'settings', 'song', 'replay', 'editor'] as const).map(
    (a) => (c: Command) => isIn(c, a),
  ),
];
/** A song and the editor take no menu shortcuts. */
const withMenus = (o: Command) => o.area !== 'song' && o.area !== 'editor';

/** Other commands on the same screen (or in every menu) that answer to the same input. */
export function clashes(id: string, kind: 'key' | 'pad' | 'mouse'): Command[] {
  const c = BY_ID.get(id);
  const mine = bound(id)[kind];
  if (!c || !mine) return [];
  const near = (o: Command) => o.area === 'menus' || (c.area === 'menus' && withMenus(o)) || SCREENS.some((on) => on(c) && on(o));
  return COMMANDS.filter((o) => o.id !== id && near(o) && (bound(o.id)[kind] === mine || (kind === 'key' && bound(o.id).key2 === mine)));
}

/**
 * Shortcuts that became one for every list: a change the player made to one of them carries over
 * (the music library's first, as it came first).
 */
const MOVED: Record<string, string> = {
  'library.options': 'lists.options',
  'stages.options': 'lists.options',
  'home.replayOptions': 'lists.options',
  'library.select': 'lists.select',
  'stages.select': 'lists.select',
  'stages.delete': 'lists.delete',
  'home.replayDelete': 'lists.delete',
};

/** Keeps only bindings of known commands, with inputs of the right shape. */
export function normalizeBindings(raw: unknown): BindingOverrides {
  const out: BindingOverrides = {};
  if (!raw || typeof raw !== 'object') return out;
  const stored = raw as Record<string, unknown>;
  const order = Object.keys(MOVED);
  const entries = Object.entries(stored)
    // An old id waits behind the others, in MOVED's order; one whose new id is stored too is dropped.
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .flatMap(([id, v]): [string, unknown][] => {
      const to = MOVED[id];
      if (!to) return [[id, v]];
      return to in stored ? [] : [[to, v]];
    });
  for (const [id, v] of entries) {
    if (id in out) continue;
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
