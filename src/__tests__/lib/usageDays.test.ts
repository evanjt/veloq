/**
 * Scenario: the install counts the distinct local days the athlete opened it
 * on, which the launch asks and the support card both wait on.
 *
 * Expected behaviour: launches on one local day count once, a launch after
 * local midnight counts again, and an install whose count was kept on the
 * support card's row carries it over rather than starting again.
 */

import { countUseDay } from '@/features/settings/lib/usageDays';
import { noteLastSyncSuccess, useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';

const mockRows = new Map<string, string>();

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async (key: string) => mockRows.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockRows.set(key, value);
  }),
}));

async function launchAt(at: Date): Promise<void> {
  jest.setSystemTime(at);
  useWhatsNewStore.setState({ usageLoaded: false });
  await useWhatsNewStore.getState().countUse();
  await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  mockRows.clear();
  useWhatsNewStore.setState({
    firstUseDate: null,
    lastUseDate: null,
    useDays: 0,
    launches: 0,
    firstSyncSettled: false,
    usageLoaded: false,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('countUseDay', () => {
  const none = { firstUseDate: null, lastUseDate: null, useDays: 0 };

  it('counts the first use as one day', () => {
    expect(countUseDay(none, '2026-05-11')).toEqual({
      firstUseDate: '2026-05-11',
      lastUseDate: '2026-05-11',
      useDays: 1,
    });
  });

  it('counts a second use on the same day as nothing new', () => {
    const once = countUseDay(none, '2026-05-11');
    expect(countUseDay(once, '2026-05-11')).toEqual(once);
  });

  it('counts a use on a later day as one more, whatever the gap', () => {
    const once = countUseDay(none, '2026-05-11');
    expect(countUseDay(once, '2026-06-30').useDays).toBe(2);
  });
});

describe('the usage row across launches', () => {
  it('counts two launches on one local day as one day', async () => {
    await launchAt(new Date(2026, 4, 11, 0, 5));
    await launchAt(new Date(2026, 4, 11, 23, 55));
    expect(useWhatsNewStore.getState().useDays).toBe(1);
  });

  it('counts a launch after local midnight as a second day', async () => {
    await launchAt(new Date(2026, 4, 11, 23, 55));
    await launchAt(new Date(2026, 4, 12, 0, 5));
    expect(useWhatsNewStore.getState().useDays).toBe(2);
    expect(JSON.parse(mockRows.get('veloq-usage') ?? '{}')).toMatchObject({
      firstUseDate: '2026-05-11',
      lastUseDate: '2026-05-12',
      useDays: 2,
    });
  });

  it('counts every launch, including those on one local day', async () => {
    await launchAt(new Date(2026, 4, 11, 9, 0));
    expect(useWhatsNewStore.getState().launches).toBe(1);
    await launchAt(new Date(2026, 4, 11, 10, 0));
    expect(useWhatsNewStore.getState().launches).toBe(2);
    expect(JSON.parse(mockRows.get('veloq-usage') ?? '{}')).toMatchObject({ launches: 2 });
  });

  it('does not count a launch twice when the store is read again in one process', async () => {
    await launchAt(new Date(2026, 4, 11, 9, 0));
    await useWhatsNewStore.getState().countUse();
    expect(useWhatsNewStore.getState().launches).toBe(1);
  });

  it('takes a record stored before launches were counted as one launch per day of use', async () => {
    mockRows.set(
      'veloq-usage',
      JSON.stringify({
        firstUseDate: '2026-05-01',
        lastUseDate: '2026-05-10',
        useDays: 4,
        firstSyncSettled: true,
      })
    );
    await launchAt(new Date(2026, 4, 11, 9, 0));
    expect(useWhatsNewStore.getState().launches).toBe(5);
  });

  it('carries over a count kept on the support card’s row', async () => {
    mockRows.set(
      'veloq-support-store',
      JSON.stringify({
        lastActionDate: '2026-04-01',
        permanentlyDismissed: false,
        isLegacyPurchaser: false,
        dismissCount: 0,
        firstUseDate: '2026-04-01',
        lastUseDate: '2026-05-10',
        useDays: 7,
      })
    );
    await launchAt(new Date(2026, 4, 11, 9, 0));
    expect(useWhatsNewStore.getState()).toMatchObject({ firstUseDate: '2026-04-01', useDays: 8 });
  });

  it('starts from today for a support row stored before the count existed', async () => {
    mockRows.set('veloq-support-store', JSON.stringify({ lastActionDate: '2026-04-01' }));
    await launchAt(new Date(2026, 4, 11, 9, 0));
    expect(useWhatsNewStore.getState()).toMatchObject({ firstUseDate: '2026-05-11', useDays: 1 });
  });

  it('keeps the clean sync it noted across a relaunch', async () => {
    await launchAt(new Date(2026, 4, 11, 9, 0));
    useWhatsNewStore.getState().noteSyncSettledClean();
    await Promise.resolve();
    await launchAt(new Date(2026, 4, 11, 10, 0));
    expect(useWhatsNewStore.getState().firstSyncSettled).toBe(true);
  });

  it('notes a clean sync only from a stamp the engine wrote', async () => {
    await launchAt(new Date(2026, 4, 11, 9, 0));
    noteLastSyncSuccess(null);
    noteLastSyncSuccess(undefined);
    expect(useWhatsNewStore.getState().firstSyncSettled).toBe(false);
    noteLastSyncSuccess('2026-05-11T09:04:00.000Z');
    expect(useWhatsNewStore.getState().firstSyncSettled).toBe(true);
  });
});
