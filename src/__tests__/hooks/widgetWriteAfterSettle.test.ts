/**
 * Scenario: a foreground sync settles while the feed is scrolling. The widget
 * refresh reads the insights bundle, ranks it in JavaScript and composes the
 * snapshot, about 65 ms of engine calls in one task, and it ran inside the
 * effect that fans the settle out to every screen.
 *
 * Expected behaviour: the settle leaves the widget write to the next idle
 * period, settles that land before it share one write, and the write still
 * happens when the hook unmounts first. Backgrounding writes at once, because
 * the process may freeze before an idle tick, and the write it makes stands in
 * for the one still waiting.
 */

import { act, renderHook } from '@testing-library/react-native';
import { StartOutcome, SyncState, type SyncStatus } from 'veloqrs';

import { useAuthStore } from '@/shared/app/AuthStore';

import { stubIdleScheduler, type IdleScheduler } from '../__shared__/idleScheduler';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const mockEngine = {
  syncNow: jest.fn(),
  triggerRefresh: jest.fn(),
  eventsAreLive: () => true,
  subscribe: jest.fn(() => () => {}),
  getInsightsData: jest.fn(),
  composeWidgetSnapshot: jest.fn(),
  setWidgetContext: jest.fn(),
};

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  isEngineReady: () => true,
}));

let mockStatus: SyncStatus | null = null;
jest.mock('@/shared/native/useSyncStatus', () => ({
  useSyncState: () => mockStatus?.state ?? null,
  useSyncLastError: () => mockStatus?.lastError,
}));

jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
  useIsOnline: () => true,
}));

jest.mock('@/features/maps/lib/basemapFlush', () => ({ flushBasemapSidecars: jest.fn() }));
jest.mock('@/features/settings/lib/autobackup', () => ({ onAppBackground: jest.fn() }));

// The widget module is installed where the platform installs it, so the
// preset's stand-ins for every other native module stay in place. The bridge
// reads it once at import, which is why the modules under test are required
// below rather than imported above.
const mockWidget = {
  writeSnapshot: jest.fn(),
  clearSnapshot: jest.fn(),
  reloadWidgets: jest.fn(),
  publishRecordShortcuts: jest.fn(),
};
(globalThis as unknown as { expo: { modules: Record<string, unknown> } }).expo.modules.VeloqWidget =
  mockWidget;

const { handleAppBackground } =
  require('@/shared/app/appBackground') as typeof import('@/shared/app/appBackground');
const { useEngineSync } =
  require('@/shared/native/useEngineSync') as typeof import('@/shared/native/useEngineSync');

const syncing: SyncStatus = {
  state: SyncState.Syncing,
  inFlight: 1,
  completed: 0,
  total: 1,
  stepItemsDone: 0,
  stepItemsTotal: 0,
  heldBackInLastDownload: 0,
};

const idle: SyncStatus = {
  state: SyncState.Idle,
  inFlight: 0,
  completed: 0,
  total: 0,
  stepItemsDone: 0,
  stepItemsTotal: 0,
  heldBackInLastDownload: 0,
};

async function runSync(rerender: (props: undefined) => void): Promise<void> {
  mockStatus = syncing;
  await act(() => rerender(undefined));
  mockStatus = idle;
  await act(() => rerender(undefined));
}

let idleScheduler: IdleScheduler;

beforeEach(() => {
  jest.clearAllMocks();
  idleScheduler = stubIdleScheduler('queued');
  mockStatus = null;
  mockEngine.syncNow.mockReturnValue(StartOutcome.Started);
  mockEngine.getInsightsData.mockReturnValue(null);
  mockEngine.composeWidgetSnapshot.mockReturnValue('{"schemaVersion":12}');
  mockEngine.setWidgetContext.mockReturnValue(true);
  useAuthStore.setState({
    isAuthenticated: true,
    isDemoMode: false,
    isLoading: false,
    authMethod: 'apiKey',
  });
});

afterEach(() => {
  // Drain whatever a test left waiting, so it cannot hold the next one's write.
  idleScheduler.flush();
  idleScheduler.restore();
});

describe('widget refresh after a sync settles', () => {
  it('reads nothing inside the settle and writes once the thread is idle', async () => {
    const { rerender } = await renderHook(() => useEngineSync());

    await runSync(rerender);

    expect(mockEngine.getInsightsData).not.toHaveBeenCalled();
    expect(mockEngine.composeWidgetSnapshot).not.toHaveBeenCalled();
    expect(mockWidget.writeSnapshot).not.toHaveBeenCalled();

    await act(() => idleScheduler.flush());

    expect(mockEngine.getInsightsData).toHaveBeenCalledTimes(1);
    expect(mockWidget.writeSnapshot).toHaveBeenCalledTimes(1);
  });

  it('writes once for two settles inside one idle window', async () => {
    const { rerender } = await renderHook(() => useEngineSync());

    await runSync(rerender);
    await runSync(rerender);
    await act(() => idleScheduler.flush());

    expect(mockEngine.getInsightsData).toHaveBeenCalledTimes(1);
    expect(mockWidget.writeSnapshot).toHaveBeenCalledTimes(1);
  });

  it('writes again for a settle after the first write ran', async () => {
    const { rerender } = await renderHook(() => useEngineSync());

    await runSync(rerender);
    await act(() => idleScheduler.flush());
    await runSync(rerender);
    await act(() => idleScheduler.flush());

    expect(mockEngine.getInsightsData).toHaveBeenCalledTimes(2);
    expect(mockWidget.writeSnapshot).toHaveBeenCalledTimes(2);
  });

  it('still writes when the hook unmounts before the thread idles', async () => {
    const { rerender, unmount } = await renderHook(() => useEngineSync());

    await runSync(rerender);
    await unmount();
    await act(() => idleScheduler.flush());

    expect(mockWidget.writeSnapshot).toHaveBeenCalledTimes(1);
  });

  it('writes at once on backgrounding, and that write replaces the waiting one', async () => {
    const { rerender } = await renderHook(() => useEngineSync());

    await runSync(rerender);
    handleAppBackground();

    expect(mockEngine.getInsightsData).toHaveBeenCalledTimes(1);
    expect(mockWidget.writeSnapshot).toHaveBeenCalledTimes(1);

    await act(() => idleScheduler.flush());

    expect(mockEngine.getInsightsData).toHaveBeenCalledTimes(1);
    expect(mockWidget.writeSnapshot).toHaveBeenCalledTimes(1);
  });
});
