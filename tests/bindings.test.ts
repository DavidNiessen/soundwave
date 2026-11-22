import { afterEach, describe, expect, it } from 'vitest';
import { bound, chordOf, clashes, commandFor, keysOf, normalizeBindings, padCommandFor, setBindings } from '../src/input/bindings';

const key = (code: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('shortcut bindings', () => {
  afterEach(() => setBindings({}));

  it('writes a key press with what is held, Cmd counting as Ctrl', () => {
    expect(chordOf(key('KeyZ'))).toBe('KeyZ');
    expect(chordOf(key('KeyZ', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+KeyZ');
    expect(chordOf(key('KeyZ', { metaKey: true }))).toBe('Ctrl+KeyZ');
    expect(chordOf(key('ArrowUp', { altKey: true }))).toBe('Alt+ArrowUp');
  });

  it('answers to the defaults, and to the second key until a key of the player’s own is chosen', () => {
    expect(commandFor(key('KeyZ', { ctrlKey: true }), 'editor')).toBe('editor.undo');
    expect(commandFor(key('Backspace'), 'editor')).toBe('editor.delete');
    expect(padCommandFor('b8', 'editor')).toBe('editor.undo');
    setBindings({ 'editor.delete': { key: 'KeyQ' } });
    expect(commandFor(key('KeyQ'), 'editor')).toBe('editor.delete');
    expect(commandFor(key('Backspace'), 'editor')).toBeNull();
    expect(bound('editor.delete').key2).toBeNull();
  });

  it('lays the player’s choices over the defaults, null clearing one', () => {
    setBindings({ 'lists.options': { key: 'Ctrl+KeyK', pad: null } });
    expect(keysOf('lists.options')).toEqual({ kbd: 'Ctrl+KeyK', pad: undefined, mouse: 'm1' });
  });

  it('keeps Esc on Back whatever is stored', () => {
    setBindings({ 'menus.back': { key: 'KeyB', mouse: 'm4' } });
    expect(bound('menus.back').key).toBe('Escape');
    expect(bound('menus.back').mouse).toBe('m4');
  });

  it('says which other shortcuts nearby answer to the same input', () => {
    setBindings({ 'library.sort': { key: 'KeyO' } });
    expect(clashes('library.sort', 'key').map((c) => c.id)).toEqual(['lists.options']);
    expect(clashes('lists.options', 'key').map((c) => c.id)).toEqual(['library.sort']);
    // The editor's own keys are not the library's.
    expect(clashes('editor.phrase', 'key').map((c) => c.id)).toEqual([]);
  });

  it('gives the songs, the stages and the replays one Options, Select and Delete, which nothing beside them clashes with', () => {
    for (const id of ['lists.options', 'lists.select', 'lists.delete'])
      for (const kind of ['key', 'pad', 'mouse'] as const) expect(clashes(id, kind).map((c) => c.id)).toEqual([]);
    // The Stage tab's own buttons do not sit on the lists' ones.
    expect(clashes('stages.new', 'pad')).toEqual([]);
    expect(clashes('stages.random', 'pad')).toEqual([]);
  });

  it('carries a change made to a list shortcut before they were one over to the shared one, the library’s first', () => {
    expect(
      normalizeBindings({
        'stages.options': { key: 'KeyP' },
        'library.options': { key: 'KeyL' },
        'home.replayDelete': { key: 'KeyK' },
        'stages.select': { pad: 'b11' },
      }),
    ).toEqual({ 'lists.options': { key: 'KeyL' }, 'lists.delete': { key: 'KeyK' }, 'lists.select': { pad: 'b11' } });
    // A change to the shared one itself wins over the old ones.
    expect(normalizeBindings({ 'library.select': { key: 'KeyJ' }, 'lists.select': { key: 'KeyH' } })).toEqual({
      'lists.select': { key: 'KeyH' },
    });
  });

  it('keeps only known shortcuts with inputs of the right shape from stored settings', () => {
    expect(
      normalizeBindings({
        'editor.undo': { key: 'Ctrl+KeyU', pad: null, mouse: 'm9' },
        'not.a.command': { key: 'KeyA' },
        'home.add': 'nonsense',
      }),
    ).toEqual({ 'editor.undo': { key: 'Ctrl+KeyU', pad: null } });
    expect(normalizeBindings(undefined)).toEqual({});
  });
});
