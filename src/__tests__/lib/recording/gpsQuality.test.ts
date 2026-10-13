/**
 * Scenario: the entry screen, the live accuracy mark and the point filter each
 * judged a fix against their own number, so an 18 m fix read ready on entry,
 * bad in the header, and was kept by the recording.
 *
 * Expected behaviour: one verdict, against the athlete's discard threshold. A fix
 * the recording keeps is ready and never marked bad; a fix it discards is weak
 * and marked bad.
 */

import { entryGpsState } from '@/features/recording/lib/recordEntry';
import { gpsFixKept, gpsQuality, gpsSignalLevel } from '@/features/recording/lib/gpsQuality';

const DEFAULT_THRESHOLD_M = 30;

describe('one GPS verdict across entry, header and filter', () => {
  it.each([3, 12, 18, 40])('agrees at %d m', (accuracy) => {
    const kept = gpsFixKept(accuracy, DEFAULT_THRESHOLD_M);
    const level = gpsSignalLevel(gpsQuality(accuracy, DEFAULT_THRESHOLD_M));
    const entry = entryGpsState(accuracy, DEFAULT_THRESHOLD_M);

    expect(entry === 'ready').toBe(kept);
    expect(level === 'bad').toBe(!kept);
  });

  it('keeps a fix at the threshold and discards one just past it', () => {
    expect(gpsQuality(30, 30)).toBe('coarse');
    expect(gpsFixKept(30, 30)).toBe(true);
    expect(gpsQuality(30.1, 30)).toBe('discarded');
    expect(gpsFixKept(30.1, 30)).toBe(false);
    expect(entryGpsState(30.1, 30)).toBe('weak');
  });

  it('follows the athlete threshold rather than a fixed one', () => {
    expect(gpsQuality(18, 10)).toBe('discarded');
    expect(entryGpsState(18, 10)).toBe('weak');
    expect(gpsQuality(60, 100)).toBe('coarse');
    expect(entryGpsState(60, 100)).toBe('ready');
  });

  it('marks a tight fix good', () => {
    expect(gpsSignalLevel(gpsQuality(3, DEFAULT_THRESHOLD_M))).toBe('ok');
    expect(gpsSignalLevel(gpsQuality(12, DEFAULT_THRESHOLD_M))).toBe('warn');
  });

  it('keeps a fix that carries no accuracy, and reads it neither ready nor bad', () => {
    expect(gpsQuality(null, DEFAULT_THRESHOLD_M)).toBe('none');
    expect(gpsFixKept(null, DEFAULT_THRESHOLD_M)).toBe(true);
    expect(gpsSignalLevel('none')).toBe('idle');
    expect(entryGpsState(null, DEFAULT_THRESHOLD_M)).toBe('weak');
  });
});
