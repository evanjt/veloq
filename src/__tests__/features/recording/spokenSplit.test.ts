/**
 * Scenario: a screen reader reads the split toast "km 3 · 5:12 /km" as letters
 * and a clock time, so the toast carries the split in words as well.
 *
 * Expected behaviour: the unit and the pace are spoken in full, in the
 * singular where the count is one, and a split with no moving time names only
 * the distance. The pace is the shared spoken pace, so it reads as every
 * other pace in the app.
 */

import { initialiseI18n, i18n } from '@/i18n';
import { spokenSplit } from '@/features/recording/lib/splitAnnouncement';

describe('spokenSplit', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  const t = (...args: Parameters<typeof i18n.t>) => i18n.t(...args);
  const KM = 1000;
  const MILE = 1609.344;

  it('speaks a metric split in minutes and seconds per kilometre', () => {
    expect(spokenSplit(t as never, 3, KM / 312, true)).toBe(
      'Kilometre 3, 5 minutes 12 seconds per kilometre'
    );
  });

  it('speaks an imperial split per mile', () => {
    expect(spokenSplit(t as never, 2, MILE / 481, false)).toBe(
      'Mile 2, 8 minutes 1 second per mile'
    );
  });

  it('drops a zero part rather than speaking it', () => {
    expect(spokenSplit(t as never, 1, KM / 60, true)).toBe('Kilometre 1, 1 minute per kilometre');
    expect(spokenSplit(t as never, 4, KM / 52, true)).toBe('Kilometre 4, 52 seconds per kilometre');
  });

  it('carries a rounded-up 60 seconds into the minute', () => {
    expect(spokenSplit(t as never, 1, KM / 299.6, true)).toBe(
      'Kilometre 1, 5 minutes per kilometre'
    );
  });

  it('names only the distance when the split has no moving time', () => {
    expect(spokenSplit(t as never, 5, null, true)).toBe('Kilometre 5');
    expect(spokenSplit(t as never, 5, null, false)).toBe('Mile 5');
  });

  it('names only the distance when the speed is too slow to have a pace', () => {
    expect(spokenSplit(t as never, 6, 0, true)).toBe('Kilometre 6');
    expect(spokenSplit(t as never, 6, 1e-9, true)).toBe('Kilometre 6');
  });
});
