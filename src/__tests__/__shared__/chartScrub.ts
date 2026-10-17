/**
 * Drives the shared chart scrub the way a finger does: touch down, then move.
 *
 * `useChartGestures` builds two pans, a manual-activation scrub and a drag.
 * Only the scrub is attached to a chart that sits in a scrolling page, so a
 * test that takes the newest `Gesture.Pan` would drive the wrong one.
 */

import { act } from '@testing-library/react-native';
import { Gesture } from 'react-native-gesture-handler';

import { SCRUB_SLOP } from '@/shared/charts/scrubPanDecision';

type Touch = { absoluteX: number; absoluteY: number; x: number };
type TouchEvent = { allTouches: Touch[] };
type Manager = { activate: jest.Mock; fail: jest.Mock };
type PanGesture = ReturnType<typeof Gesture.Pan>;
type PanHandlers = {
  onTouchesDown?: (e: TouchEvent) => void;
  onTouchesMove?: (e: TouchEvent, mgr: Manager) => void;
  onTouchesUp?: (e: TouchEvent, mgr: Manager) => void;
  onStart?: (e: { x: number }) => void;
  onUpdate?: (e: { x: number }) => void;
  onFinalize?: () => void;
};

// One frame, which the animated reaction and `runOnJS` need to deliver a selection.
const FRAME_MS = 16;

// Mid-screen, clear of the back-swipe strip.
const WINDOW_X = 200;
const WINDOW_Y = 100;

/** Lets `ms` pass on whichever clock the suite runs: the fake one when timers are faked, else the real one. */
async function elapse(ms: number) {
  if ('clock' in setTimeout) {
    jest.advanceTimersByTime(ms);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const handlersOf = (gesture: PanGesture) =>
  (gesture as unknown as { handlers: PanHandlers }).handlers;

const manager = (): Manager => ({ activate: jest.fn(), fail: jest.fn() });

/** A touch at chart-local `x`, moved `dx` and `dy` from where it went down. */
export const touchAt = (x: number, dx = 0, dy = 0): TouchEvent => ({
  allTouches: [{ absoluteX: WINDOW_X + dx, absoluteY: WINDOW_Y + dy, x: x + dx }],
});

/** Records every pan gesture built until the spy is restored. */
export function capturePans(): PanGesture[] {
  const built: PanGesture[] = [];
  const real = Gesture.Pan.bind(Gesture);
  jest.spyOn(Gesture, 'Pan').mockImplementation(() => {
    const gesture = real();
    built.push(gesture);
    return gesture;
  });
  return built;
}

/** The scrub pan: the one with manual activation. Newest first, since a rebuilt chart supersedes. */
export function scrubPan(built: PanGesture[]): PanGesture {
  const found = [...built].reverse().find((g) => handlersOf(g).onTouchesDown !== undefined);
  if (!found) throw new Error('no manual-activation pan was built');
  return found;
}

/** Feed `touchesDown` and the touch moves to the scrub pan, returning the manager it decided with. */
export async function touchAndMove(pan: PanGesture, down: TouchEvent, moves: TouchEvent[]) {
  const h = handlersOf(pan);
  const mgr = manager();
  await act(async () => {
    h.onTouchesDown?.(down);
    for (const move of moves) h.onTouchesMove?.(move, mgr);
    await elapse(FRAME_MS);
  });
  return mgr;
}

/**
 * Press at `startX`, move just past the slop to start the scrub, then move
 * through `xs`. The touch is left down; call `release` to lift it.
 */
export async function scrub(pan: PanGesture, startX: number, xs: number[] = []) {
  const h = handlersOf(pan);
  const mgr = manager();
  const startTravel = SCRUB_SLOP + 1;
  await act(async () => {
    h.onTouchesDown?.(touchAt(startX - startTravel));
    h.onTouchesMove?.(touchAt(startX - startTravel, startTravel), mgr);
    h.onStart?.({ x: startX });
    for (const x of xs) {
      h.onTouchesMove?.(touchAt(x), mgr);
      h.onUpdate?.({ x });
    }
    await elapse(FRAME_MS);
  });
  return mgr;
}

export async function release(pan: PanGesture) {
  await act(async () => {
    handlersOf(pan).onFinalize?.();
    await elapse(50);
  });
}

/** Press at `x` and lift after `heldMs` without moving, then let the clock run on. */
export async function pressAndLift(pan: PanGesture, x: number, heldMs: number) {
  const h = handlersOf(pan);
  const mgr = manager();
  await act(async () => {
    h.onTouchesDown?.(touchAt(x));
    await elapse(heldMs);
    h.onTouchesUp?.({ allTouches: [] }, mgr);
    await elapse(heldMs);
  });
  return mgr;
}
