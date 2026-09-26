/**
 * Scenario: the notice's dismissal lived in memory, so one walk with no
 * usable track brought "1 route didn't download" back on every launch, and a
 * different failure with the same count was read as the same one.
 *
 * Expected behaviour: a closed notice stays closed for the same set of
 * failures across launches, opens again for a different set, and comes down
 * when a run lands everything.
 */

import {
  DISMISSED_KEY,
  loadTrackFetchNotice,
  reportTrackFetchRun,
  tracksStillMissing,
  useTrackFetchNotice,
} from '@/features/routes/lib/trackFetchNotice';

const mockSettings = new Map<string, string>();
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async (key: string) => mockSettings.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockSettings.set(key, value);
  }),
}));

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fresh() {
  useTrackFetchNotice.setState({
    failedIds: [],
    failedCount: 0,
    dismissed: false,
    dismissedKey: null,
  });
}

describe('tracksStillMissing', () => {
  it('counts what the retries could not land', () => {
    expect(tracksStillMissing({ failedIds: ['a', 'b', 'c'] })).toBe(3);
  });

  it('says nothing about a run that landed everything', () => {
    expect(tracksStillMissing({ failedIds: [] })).toBe(0);
  });

  it('says nothing about a run that produced no result', () => {
    expect(tracksStillMissing(null)).toBe(0);
  });
});

describe('the notice', () => {
  beforeEach(() => {
    mockSettings.clear();
    fresh();
  });

  it('stands after a run that left tracks behind', () => {
    reportTrackFetchRun({ failedIds: ['a', 'b'] });

    expect(useTrackFetchNotice.getState()).toMatchObject({ failedCount: 2, dismissed: false });
  });

  it('comes down when the next run lands them', () => {
    reportTrackFetchRun({ failedIds: ['a'] });
    reportTrackFetchRun({ failedIds: [] });

    expect(useTrackFetchNotice.getState().failedCount).toBe(0);
  });

  it('comes back for a different set of failures after it was dismissed', () => {
    reportTrackFetchRun({ failedIds: ['a'] });
    useTrackFetchNotice.getState().dismiss();
    reportTrackFetchRun({ failedIds: ['b'] });

    expect(useTrackFetchNotice.getState()).toMatchObject({ failedCount: 1, dismissed: false });
  });

  it('stays closed when the next run fails on the same set, in any order', () => {
    reportTrackFetchRun({ failedIds: ['b', 'a'] });
    useTrackFetchNotice.getState().dismiss();
    reportTrackFetchRun({ failedIds: ['a', 'b'] });

    expect(useTrackFetchNotice.getState()).toMatchObject({ failedCount: 2, dismissed: true });
  });

  it('remembers the dismissal across a relaunch', async () => {
    reportTrackFetchRun({ failedIds: ['walk'] });
    useTrackFetchNotice.getState().dismiss();
    await flush();
    expect(mockSettings.get(DISMISSED_KEY)).toBe('walk');

    fresh();
    await loadTrackFetchNotice();
    reportTrackFetchRun({ failedIds: ['walk'] });

    expect(useTrackFetchNotice.getState().dismissed).toBe(true);
  });

  it('applies a dismissal that loads after the run reported', async () => {
    mockSettings.set(DISMISSED_KEY, 'walk');
    reportTrackFetchRun({ failedIds: ['walk'] });
    expect(useTrackFetchNotice.getState().dismissed).toBe(false);

    await loadTrackFetchNotice();

    expect(useTrackFetchNotice.getState().dismissed).toBe(true);
  });
});
