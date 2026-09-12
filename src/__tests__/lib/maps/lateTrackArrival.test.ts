/**
 * Scenario: a marker tap starts a fetch and waits up to fifteen seconds for the
 * track to land, then calls `setSelected` with it unconditionally. Tapping a
 * marker, dismissing the popup and tapping another reopened the first one when
 * its track arrived, or replaced the second with it, and the same happened
 * after the screen had gone.
 *
 * Expected behaviour: a track that lands answers for the marker that is on
 * screen now, or it is dropped.
 */

import { trackStillWanted } from '@/features/maps/lib/gpsTrackWait';

describe('a track that lands late', () => {
  it('is shown when it is still the marker on screen', () => {
    expect(trackStillWanted('a1', 'a1', true)).toBe(true);
  });

  it('is dropped when the athlete has tapped another marker', () => {
    expect(trackStillWanted('a1', 'a2', true)).toBe(false);
  });

  it('is dropped when the popup has been dismissed', () => {
    expect(trackStillWanted('a1', null, true)).toBe(false);
  });

  it('is dropped when the screen has gone', () => {
    expect(trackStillWanted('a1', 'a1', false)).toBe(false);
  });
});
