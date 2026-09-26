/**
 * Scenario: a GPS backfill announces `activities` once per batch, and the map
 * page answered each announcement by re-reading every row of the `signatures`
 * table, decoding and re-encoding each blob in Rust and decoding it again in JS.
 *
 * Expected behaviour: a burst of announcements costs two rebuilds, not one per
 * announcement, and the first one still runs at once so the map does not wait
 * for the burst to finish.
 */

import { createCoalescer, type Cancel } from '@/shared/async/coalesceRefresh';

/** A scheduler the test drives by hand, so nothing here waits on a clock. */
function fakeScheduler() {
  let queued: (() => void) | null = null;
  let cancelled = 0;
  return {
    schedule: (fn: () => void): Cancel => {
      queued = fn;
      return () => {
        queued = null;
        cancelled++;
      };
    },
    /** Close the window. Returns whether there was one to close. */
    closeWindow: () => {
      const fn = queued;
      queued = null;
      fn?.();
      return fn !== null;
    },
    isScheduled: () => queued !== null,
    cancelled: () => cancelled,
  };
}

describe('coalescing the map signature rebuild', () => {
  it('runs the first event at once, so the map is not held for the burst', () => {
    const run = jest.fn();
    const clock = fakeScheduler();
    const coalescer = createCoalescer(run, 250, clock.schedule);

    coalescer.request();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('spends a whole burst on one more run rather than one run each', () => {
    const run = jest.fn();
    const clock = fakeScheduler();
    const coalescer = createCoalescer(run, 250, clock.schedule);

    for (let i = 0; i < 40; i++) coalescer.request();
    expect(run).toHaveBeenCalledTimes(1);
    expect(coalescer.isPending()).toBe(true);

    clock.closeWindow();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not run again for a window nothing arrived in', () => {
    const run = jest.fn();
    const clock = fakeScheduler();
    const coalescer = createCoalescer(run, 250, clock.schedule);

    coalescer.request();
    clock.closeWindow();

    expect(run).toHaveBeenCalledTimes(1);
    expect(coalescer.isPending()).toBe(false);
  });

  it('answers a later event at once, the window having closed', () => {
    const run = jest.fn();
    const clock = fakeScheduler();
    const coalescer = createCoalescer(run, 250, clock.schedule);

    coalescer.request();
    clock.closeWindow();
    coalescer.request();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('treats the trailing run as a leading edge, so a continuing burst pays once per window', () => {
    const run = jest.fn();
    const clock = fakeScheduler();
    const coalescer = createCoalescer(run, 250, clock.schedule);

    coalescer.request(); // runs, window opens
    coalescer.request(); // owed
    clock.closeWindow(); // runs, window reopens
    expect(run).toHaveBeenCalledTimes(2);

    coalescer.request(); // owed again, not run
    expect(run).toHaveBeenCalledTimes(2);
    clock.closeWindow();
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('drops a pending run when cancelled, so an unmounted page rebuilds nothing', () => {
    const run = jest.fn();
    const clock = fakeScheduler();
    const coalescer = createCoalescer(run, 250, clock.schedule);

    coalescer.request();
    coalescer.request();
    expect(coalescer.isPending()).toBe(true);

    coalescer.cancel();

    expect(coalescer.isPending()).toBe(false);
    expect(clock.isScheduled()).toBe(false);
    expect(clock.cancelled()).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('is safe to cancel when nothing is pending', () => {
    const run = jest.fn();
    const clock = fakeScheduler();
    const coalescer = createCoalescer(run, 250, clock.schedule);

    expect(() => coalescer.cancel()).not.toThrow();
    coalescer.request();
    clock.closeWindow();
    expect(() => coalescer.cancel()).not.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('is the window length the caller asked for', () => {
    const run = jest.fn();
    const seen: number[] = [];
    const coalescer = createCoalescer(run, 250, (_fn, ms) => {
      seen.push(ms);
      return () => {};
    });

    coalescer.request();

    expect(seen).toEqual([250]);
  });
});
