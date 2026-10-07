/**
 * Scenario: the launch sync lands its pages one after another, and each one
 * announces `activities`. The startup bundle is a single FFI call that costs
 * 70 to 85 ms on the JS thread under the engine write lock, and a trace of a
 * real launch caught it running five times in the first four and a half
 * seconds for one screen's worth of data.
 *
 * Expected behaviour: the bundle is read once while a sync is in flight, and
 * again when that sync settles. Announcements outside a sync still refresh it,
 * because then they are the only signal there is.
 *
 * Scenario: the sync writes the athlete profile and wellness before any
 * activity, so the read at mount, and the one the wellness announcement
 * spends, see an empty library.
 *
 * Expected behaviour: a read that saw no activity does not spend the sync's one
 * read, so the first announcement of stored rows reads again and the card's
 * week and the feed's previews do not wait for the settle.
 */

import { act, renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { useStartupData } from '@/features/home/hooks/useStartupData';
import { SyncState } from 'veloqrs';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: (encoded: string) => mockEncodedCoords.get(encoded) ?? [],
  })
);

jest.mock('@/features/insights/lib/insightsParams', () => ({
  buildInsightsParams: () => ({}),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const listeners = new Map<string, Set<() => void>>();
let syncState: SyncState = SyncState.Syncing;
let reads = 0;
let storedActivities = 1;
const mockEncodedCoords = new Map<string, { latitude: number; longitude: number }[]>();
let mockPreviewRecords: { activityId: string; encodedCoords: string }[] = [];

function engine() {
  return {
    getSyncStatus: () => ({ state: syncState }),
    getStartupData: () => {
      reads += 1;
      return {
        summaryCard: { currentWeek: { count: storedActivities } },
        previewTracks: mockPreviewRecords,
      };
    },
    subscribe: (event: string, cb: () => void) => {
      const forEvent = listeners.get(event) ?? new Set<() => void>();
      forEvent.add(cb);
      listeners.set(event, forEvent);
      return () => forEvent.delete(cb);
    },
  } as unknown as ReturnType<typeof getEngine>;
}

/**
 * Fire a channel, then let the deferred read run. Two acts, because the effect
 * the callback schedules is only flushed when the first one returns, and a
 * timer run inside it would come too early to see the interaction.
 */
function announce(event: string) {
  act(() => {
    listeners.get(event)?.forEach((cb) => cb());
  });
  act(() => {
    jest.runOnlyPendingTimers();
  });
}

describe('useStartupData read count', () => {
  let unmountRendered: (() => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    listeners.clear();
    reads = 0;
    storedActivities = 1;
    mockEncodedCoords.clear();
    mockPreviewRecords = [];
    syncState = SyncState.Syncing;
    mockGetEngine.mockReturnValue(engine());
  });

  afterEach(() => {
    // Unmount on the fake clock the test rendered on. Left to the testing
    // library's own cleanup, the unmount runs after `useRealTimers` has swapped
    // the clock out from under React, and an unmount that then has to wait on
    // React waits forever: three of these five tests spent the full 30 s hook
    // budget in that cleanup on the CI runner, twice, and never here.
    act(() => {
      unmountRendered?.();
    });
    unmountRendered = null;
    jest.useRealTimers();
  });

  function mount() {
    const rendered = renderHook(() => useStartupData(['a1']));
    unmountRendered = rendered.unmount;
    act(() => {
      jest.runOnlyPendingTimers();
    });
    return rendered;
  }

  it('reads once when a launch sync announces five times', () => {
    mount();

    for (let i = 0; i < 5; i += 1) announce('activities');

    expect(reads).toBe(1);
  });

  it('reads again for the first stored rows when the read at mount saw an empty library', () => {
    storedActivities = 0;
    mount();
    expect(reads).toBe(1);

    storedActivities = 3;
    announce('activities');
    expect(reads).toBe(2);

    announce('activities');
    announce('activities');
    expect(reads).toBe(2);
  });

  it('reads again when the sync settles, so the feed is not left stale', () => {
    mount();
    announce('activities');
    expect(reads).toBe(1);

    syncState = SyncState.Idle;
    announce('syncSettled');

    expect(reads).toBe(2);
  });

  it('still refreshes on an announcement outside a sync', () => {
    syncState = SyncState.Idle;
    mount();
    expect(reads).toBe(1);

    announce('sections');

    expect(reads).toBe(2);
  });

  it('paints from the first read even though a sync is running', () => {
    const { result } = mount();

    expect(reads).toBe(1);
    expect(result.current.data).not.toBeNull();
  });

  it('does not read again when the settle brings nothing new to announce', () => {
    syncState = SyncState.Idle;
    mount();
    const after = reads;

    announce('syncSettled');

    expect(reads).toBe(after);
  });

  it('retains an unchanged startup track while replacing its changed neighbour', () => {
    syncState = SyncState.Idle;
    mockEncodedCoords.set('old', [{ latitude: 46.2, longitude: 7.3 }]);
    mockEncodedCoords.set('new', [{ latitude: 47.1, longitude: 7.3 }]);
    mockEncodedCoords.set('same', [{ latitude: 46.5, longitude: 7.3 }]);
    mockPreviewRecords = [
      { activityId: 'a1', encodedCoords: 'old' },
      { activityId: 'a2', encodedCoords: 'same' },
    ];
    const { result } = mount();
    const firstA1 = result.current.data?.previewTracks.get('a1');
    const firstA2 = result.current.data?.previewTracks.get('a2');

    mockPreviewRecords = [
      { activityId: 'a1', encodedCoords: 'new' },
      { activityId: 'a2', encodedCoords: 'same' },
    ];
    announce('sections');

    expect(result.current.data?.previewTracks.get('a1')).not.toBe(firstA1);
    expect(result.current.data?.previewTracks.get('a2')).toBe(firstA2);
  });
});
