/**
 * Scenario: the chart scrub drives the 3D map's highlight marker at 60fps,
 * then the finger lifts and the selection clears.
 *
 * Expected behaviour: the ticks inside the window are deferred rather than
 * dropped, so the last position still reaches the page, and clearing the
 * highlight is never throttled at all.
 */
import { planHighlightSend } from '@/features/maps/lib/highlightThrottle';
import { HIGHLIGHT_THROTTLE_MS } from '@/features/maps/lib/mapBudgets';

describe('planHighlightSend', () => {
  it('sends the first highlight', () => {
    expect(planHighlightSend(null, 1000, [7.3, 46.2])).toEqual({ kind: 'send' });
  });

  it('defers a highlight inside the window for the rest of it', () => {
    const lastSentAt = 1000;
    expect(planHighlightSend(lastSentAt, lastSentAt + 4, [7.3, 46.2])).toEqual({
      kind: 'defer',
      afterMs: HIGHLIGHT_THROTTLE_MS - 4,
    });
  });

  it('sends a highlight once the window has passed', () => {
    const lastSentAt = 1000;
    expect(planHighlightSend(lastSentAt, lastSentAt + HIGHLIGHT_THROTTLE_MS, [7.3, 46.2])).toEqual({
      kind: 'send',
    });
  });

  it('never throttles a hide, whatever the window says', () => {
    expect(planHighlightSend(1000, 1001, null)).toEqual({ kind: 'send' });
  });

  it('sends when the clock has gone backwards', () => {
    expect(planHighlightSend(5000, 10, [7.3, 46.2])).toEqual({ kind: 'send' });
  });
});
