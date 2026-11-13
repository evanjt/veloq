/**
 * interactionPacer tests
 *
 * Scenario: the engine's background passes widen the gap between units of work
 * while the athlete is touching the screen.
 *
 * Expected behaviour: the first touch says "interacting", a long gesture
 * restates it before Rust's copy expires, and a second without a touch says
 * "idle". Touch events arrive at frame rate, so a gesture that is already
 * stated costs no engine call.
 */

import {
  createInteractionPacer,
  IDLE_AFTER_MS,
  RESTATE_EVERY_MS,
} from '@/shared/app/interactionPacer';

describe('interactionPacer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });
  afterEach(() => jest.useRealTimers());

  it('states interacting once for a burst of touches', () => {
    const push = jest.fn();
    const pacer = createInteractionPacer(push);

    pacer.touch();
    jest.advanceTimersByTime(16);
    pacer.touch();
    jest.advanceTimersByTime(16);
    pacer.touch();

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(true);
  });

  it('states idle once the athlete has not touched for the idle window', () => {
    const push = jest.fn();
    const pacer = createInteractionPacer(push);

    pacer.touch();
    jest.advanceTimersByTime(IDLE_AFTER_MS - 1);
    expect(push).toHaveBeenLastCalledWith(true);

    jest.advanceTimersByTime(1);
    expect(push).toHaveBeenLastCalledWith(false);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('a touch inside the window pushes the idle back', () => {
    const push = jest.fn();
    const pacer = createInteractionPacer(push);

    pacer.touch();
    jest.advanceTimersByTime(IDLE_AFTER_MS - 100);
    pacer.touch();
    jest.advanceTimersByTime(IDLE_AFTER_MS - 100);

    expect(push).not.toHaveBeenCalledWith(false);

    jest.advanceTimersByTime(100);
    expect(push).toHaveBeenLastCalledWith(false);
  });

  it('restates a gesture that outlasts the restate interval, and no more often', () => {
    const push = jest.fn();
    const pacer = createInteractionPacer(push);

    // A touch every 100 ms for three restate intervals.
    for (let elapsed = 0; elapsed <= 3 * RESTATE_EVERY_MS; elapsed += 100) {
      pacer.touch();
      jest.advanceTimersByTime(100);
    }

    const stated = push.mock.calls.filter(([interacting]) => interacting === true).length;
    expect(stated).toBe(4);
    expect(push).not.toHaveBeenCalledWith(false);
  });

  it('states interacting again for a second gesture after idle', () => {
    const push = jest.fn();
    const pacer = createInteractionPacer(push);

    pacer.touch();
    jest.advanceTimersByTime(IDLE_AFTER_MS);
    pacer.touch();

    expect(push.mock.calls.map(([v]) => v)).toEqual([true, false, true]);
  });

  it('stop states idle at once and leaves no timer behind', () => {
    const push = jest.fn();
    const pacer = createInteractionPacer(push);

    pacer.touch();
    pacer.stop();
    expect(push).toHaveBeenLastCalledWith(false);

    jest.advanceTimersByTime(10 * IDLE_AFTER_MS);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('stop on a pacer that was never touched states nothing', () => {
    const push = jest.fn();
    createInteractionPacer(push).stop();

    expect(push).not.toHaveBeenCalled();
  });
});
