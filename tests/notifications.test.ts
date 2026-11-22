import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dismiss,
  dismissAll,
  hold,
  LEAVE_MS,
  lifeOf,
  MAX_SHOWN,
  notify,
  onRaised,
  resetNotifications,
  snapshot,
} from '../src/ui/notifications';

const live = () => snapshot().items.filter((n) => !n.leaving);

describe('notifications', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetNotifications();
  });
  afterEach(() => {
    resetNotifications();
    vi.useRealTimers();
  });

  it('keeps the tone it was raised with', () => {
    notify.error('Could not import a.mp3');
    notify.success('Saved a.soundwave');
    notify('Already in your library');
    expect(live().map((n) => n.tone)).toEqual(['error', 'success', 'info']);
  });

  it('counts the same message again instead of stacking a copy, and starts its time over', () => {
    notify.warning('The setlist is full.');
    vi.advanceTimersByTime(5000);
    notify.warning('The setlist is full.');
    expect(live()).toHaveLength(1);
    expect(live()[0].count).toBe(2);
    // The first raise would have run out at 6 s; the second gives it its full time again.
    vi.advanceTimersByTime(2000);
    expect(live()).toHaveLength(1);
    vi.advanceTimersByTime(lifeOf('warning', 'The setlist is full.'));
    expect(live()).toHaveLength(0);
  });

  it('tells the same words in another tone apart', () => {
    notify.error('Done');
    notify.success('Done');
    expect(live()).toHaveLength(2);
  });

  it(`shows at most ${MAX_SHOWN}, pushing out the oldest`, () => {
    for (const n of [1, 2, 3, 4]) notify.info(`Message ${n}`);
    expect(live().map((n) => n.text)).toEqual(['Message 2', 'Message 3', 'Message 4']);
  });

  it('goes on its own, fading out before it is removed', () => {
    notify.success('Saved');
    vi.advanceTimersByTime(lifeOf('success', 'Saved'));
    expect(snapshot().items[0].leaving).toBe(true);
    vi.advanceTimersByTime(LEAVE_MS);
    expect(snapshot().items).toHaveLength(0);
  });

  it('stays longer for a longer message and for an error, but never for ever', () => {
    expect(lifeOf('error', 'x')).toBeGreaterThan(lifeOf('info', 'x'));
    expect(lifeOf('info', 'x'.repeat(120))).toBeGreaterThan(lifeOf('info', 'x'));
    expect(lifeOf('info', 'x'.repeat(5000))).toBeLessThanOrEqual(14000);
  });

  it('waits while held, and goes on with the time it had left', () => {
    const life = lifeOf('info', 'Hello');
    notify.info('Hello');
    vi.advanceTimersByTime(life - 1000);
    hold(true);
    expect(snapshot().held).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(live()).toHaveLength(1);
    hold(false);
    vi.advanceTimersByTime(999);
    expect(live()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(live()).toHaveLength(0);
  });

  it('is dismissed one at a time or all at once', () => {
    const a = notify.info('A');
    notify.info('B');
    dismiss(a);
    expect(live().map((n) => n.text)).toEqual(['B']);
    expect(dismissAll()).toBe(true);
    expect(live()).toHaveLength(0);
    expect(dismissAll()).toBe(false);
  });

  it('tells listeners of every raise, the repeats too, for their sound', () => {
    const heard: string[] = [];
    const stop = onRaised((n) => heard.push(`${n.tone}:${n.count}`));
    notify.error('No');
    notify.error('No');
    stop();
    notify.error('No');
    expect(heard).toEqual(['error:1', 'error:2']);
  });
});
