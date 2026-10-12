/**
 * Scenario: a fresh install's first sync writes wellness before it finishes
 * landing activities. The startup bundle holds every announcement while a sync
 * is in flight, so the card kept the zeros of the read that ran before wellness
 * existed, and a pull to refresh reads queries the card is not painted from.
 *
 * Expected behaviour: wellness is written once per sync, not once per page, so
 * its announcement reads the bundle straight away rather than waiting for the
 * settle. A refresh reads it too, so the card and the Fitness screen cannot
 * disagree.
 */

import { act, renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { useStartupData } from '@/features/home/hooks/useStartupData';
import { SyncState } from 'veloqrs';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: () => [],
  })
);

jest.mock('@/features/insights/lib/insightsParams', () => ({
  buildInsightsParams: () => ({}),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

type Listener = (payload?: { kind?: string }) => void;

const listeners = new Map<string, Set<Listener>>();
let syncState: SyncState = SyncState.Syncing;
let reads = 0;
let ctl = 0;

function engine() {
  return {
    getSyncStatus: () => ({ state: syncState }),
    getStartupData: () => {
      reads += 1;
      return { summaryCard: { ctl }, previewTracks: [] };
    },
    subscribe: (event: string, cb: Listener) => {
      const forEvent = listeners.get(event) ?? new Set<Listener>();
      forEvent.add(cb);
      listeners.set(event, forEvent);
      return () => forEvent.delete(cb);
    },
  } as unknown as ReturnType<typeof getEngine>;
}

async function announce(event: string, payload?: { kind?: string }) {
  await act(() => {
    listeners.get(event)?.forEach((cb) => cb(payload));
  });
  await act(() => {
    jest.runOnlyPendingTimers();
  });
}

describe('the summary card follows the wellness it summarises', () => {
  let unmountRendered: (() => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    listeners.clear();
    reads = 0;
    ctl = 0;
    syncState = SyncState.Syncing;
    mockGetEngine.mockReturnValue(engine());
  });

  afterEach(async () => {
    await act(() => {
      unmountRendered?.();
    });
    unmountRendered = null;
    jest.useRealTimers();
  });

  async function mount() {
    const rendered = await renderHook(() => useStartupData(['a1']));
    unmountRendered = rendered.unmount;
    await act(() => {
      jest.runOnlyPendingTimers();
    });
    return rendered;
  }

  it('reads the bundle when wellness lands mid-sync, without waiting for the settle', async () => {
    const { result } = await mount();
    expect(reads).toBe(1);
    expect(result.current.data?.summaryCardData).toEqual({ ctl: 0 });

    ctl = 38;
    await announce('bodyStored', { kind: 'wellness' });

    expect(reads).toBe(2);
    expect(result.current.data?.summaryCardData).toEqual({ ctl: 38 });
  });

  it('leaves a body of some other kind alone, so the hold still holds', async () => {
    await mount();
    expect(reads).toBe(1);

    await announce('bodyStored', { kind: 'activity_detail' });

    expect(reads).toBe(1);
  });

  it('reads the bundle when the feed refreshes, whatever the sync is doing', async () => {
    const { result } = await mount();
    expect(reads).toBe(1);

    ctl = 38;
    await act(() => {
      result.current.refresh();
    });
    await act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(reads).toBe(2);
    expect(result.current.data?.summaryCardData).toEqual({ ctl: 38 });
  });
});
