/**
 * Whether a highlight change goes to the 3D page now or waits out the window.
 *
 * The scrub drives this at 60fps, so the window is what keeps the bridge from
 * flooding. Dropping the tick that lands inside it is what leaves the marker
 * behind the finger, so a deferred tick says how long to wait and the caller
 * arms a timer for it. Clearing the highlight is not a tick in a stream, it is
 * the end of one, so it is never throttled.
 */
import { HIGHLIGHT_THROTTLE_MS } from '@/features/maps/lib/mapBudgets';

export type HighlightPlan = { kind: 'send' } | { kind: 'defer'; afterMs: number };

export function planHighlightSend(
  lastSentAt: number | null,
  now: number,
  coordinate: [number, number] | null | undefined
): HighlightPlan {
  if (!coordinate) return { kind: 'send' };
  if (lastSentAt === null) return { kind: 'send' };
  const elapsed = now - lastSentAt;
  if (elapsed >= HIGHLIGHT_THROTTLE_MS || elapsed < 0) return { kind: 'send' };
  return { kind: 'defer', afterMs: HIGHLIGHT_THROTTLE_MS - elapsed };
}
