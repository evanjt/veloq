/**
 * Scenario: a screen reader reads the split toast "km 3 · 5:12 /km" as letters
 * and a clock time, so the toast carries the split in words as well.
 *
 * Expected behaviour: the unit and the pace are spoken in full, in the
 * singular where the count is one, and a split with no moving time names only
 * the distance. The pace seconds come from the engine, so the speech is the
 * shared spoken pace and no pace is worked out in the app.
 */

import { recordings } from 'veloqrs';

import { initialiseI18n, i18n } from '@/i18n';
import { spokenSplit } from '@/features/recording/lib/splitAnnouncement';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

const livePace = recordings.livePace as jest.Mock;

describe('spokenSplit', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  beforeEach(() => {
    livePace.mockReset();
    livePace.mockReturnValue({ text: 'unused', seconds: undefined });
  });

  const t = (...args: Parameters<typeof i18n.t>) => i18n.t(...args);
  const withSeconds = (seconds: number | undefined) =>
    livePace.mockReturnValue({ text: 'unused', seconds });

  it('speaks a metric split in minutes and seconds per kilometre', () => {
    withSeconds(312);
    expect(spokenSplit(t as never, 3, 3.2, true)).toBe(
      'Kilometre 3, 5 minutes 12 seconds per kilometre'
    );
    expect(livePace).toHaveBeenCalledWith(3.2, undefined, true);
  });

  it('speaks an imperial split per mile', () => {
    withSeconds(481);
    expect(spokenSplit(t as never, 2, 3.35, false)).toBe('Mile 2, 8 minutes 1 second per mile');
  });

  it('drops a zero part rather than speaking it', () => {
    withSeconds(60);
    expect(spokenSplit(t as never, 1, 1, true)).toBe('Kilometre 1, 1 minute per kilometre');
    withSeconds(52);
    expect(spokenSplit(t as never, 4, 1, true)).toBe('Kilometre 4, 52 seconds per kilometre');
  });

  it('carries a rounded-up 60 seconds into the minute', () => {
    withSeconds(299.6);
    expect(spokenSplit(t as never, 1, 1, true)).toBe('Kilometre 1, 5 minutes per kilometre');
  });

  it('names only the distance when the split has no moving time, without asking the engine', () => {
    expect(spokenSplit(t as never, 5, null, true)).toBe('Kilometre 5');
    expect(spokenSplit(t as never, 5, null, false)).toBe('Mile 5');
    expect(livePace).not.toHaveBeenCalled();
  });

  it('names only the distance when the engine has no pace for the speed', () => {
    withSeconds(undefined);
    expect(spokenSplit(t as never, 6, 0, true)).toBe('Kilometre 6');
  });
});
