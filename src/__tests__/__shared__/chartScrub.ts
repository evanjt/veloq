/**
 * Drives the shared chart scrub the way a finger does: touch down, hold, move.
 *
 * `useChartGestures` builds two pans, a manual-activation long press and a
 * drag. Only the long press is attached to a chart that sits in a scrolling
 * page, so a test that takes the newest `Gesture.Pan` would drive the wrong one.
 */

import { act } from '@testing-library/react-native';
import { Gesture } from 'react-native-gesture-handler';

import { PREVIEW_HOLD_MS } from '@/shared/ui/holdDurations';

type Touch = { absoluteY: number; x: number };
type TouchEvent = { allTouches: Touch[] };
type Manager = { activate: jest.Mock; fail: jest.Mock };
type PanGesture = ReturnType<typeof Gesture.Pan>;
type PanHandlers = {
  onTouchesDown?: (e: TouchEvent) => void;
  onTouchesMove?: (e: TouchEvent, mgr: Manager) => void;
  onTouchesUp?: (e: TouchEvent, mgr: Manager) => void;
  onStart?: (e: { x: number }) => void;
  onUpdate?: (e: { x: number }) => void;
  onEnd?: () => void;
};

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

/** The long-press pan: the one with manual activation. Newest first, since a rebuilt chart supersedes. */
export function longPressPan(built: PanGesture[]): PanGesture {
  const found = [...built].reverse().find((g) => handlersOf(g).onTouchesDown !== undefined);
  if (!found) throw new Error('no manual-activation pan was built');
  return found;
}

/**
 * Press at `startX`, hold past the long-press wait, then move through `xs`.
 * The touch is left down; call `release` to lift it.
 */
export async function holdAndScrub(pan: PanGesture, startX: number, xs: number[] = []) {
  const h = handlersOf(pan);
  const mgr: Manager = { activate: jest.fn(), fail: jest.fn() };
  const touch = (x: number) => ({ allTouches: [{ absoluteY: 100, x }] });
  await act(async () => {
    h.onTouchesDown?.(touch(startX));
    await elapse(PREVIEW_HOLD_MS + 1);
    h.onTouchesMove?.(touch(startX), mgr);
    h.onStart?.({ x: startX });
    for (const x of xs) {
      h.onTouchesMove?.(touch(x), mgr);
      h.onUpdate?.({ x });
    }
    await Promise.resolve();
  });
  return mgr;
}

export async function release(pan: PanGesture) {
  await act(async () => {
    handlersOf(pan).onEnd?.();
    await elapse(50);
  });
}

/** Press at `x`, lift after `heldMs` without reaching the long-press wait, then let the clock run on. */
export async function pressAndLift(pan: PanGesture, x: number, heldMs: number) {
  const h = handlersOf(pan);
  const mgr: Manager = { activate: jest.fn(), fail: jest.fn() };
  await act(async () => {
    h.onTouchesDown?.({ allTouches: [{ absoluteY: 100, x }] });
    await elapse(heldMs);
    h.onTouchesUp?.({ allTouches: [] }, mgr);
    await elapse(PREVIEW_HOLD_MS * 2);
  });
  return mgr;
}
