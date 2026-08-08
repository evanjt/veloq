/**
 * Scenario: the fitness charts, the summary card and the widget all read
 * wellness from SQLite, so something has to ask Rust to refetch it. This helper
 * is that trigger, fired on foreground, pull-to-refresh, sync completion and
 * the periodic background task.
 *
 * Expected behaviour: it only fires when there is a credential to fire with,
 * it never throws into its callers, and the awaited variant does not return
 * until the sync has settled, because the background notification task reads
 * the rows immediately afterwards.
 */

import { useAuthStore } from '@/shared/app/AuthStore';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { refreshWellness, refreshWellnessAndWait } from '@/shared/native/refreshWellness';

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: jest.fn(),
}));

const syncWellnessNow = jest.fn();
const getSyncStatus = jest.fn();
const mockGetRouteEngine = getRouteEngine as jest.MockedFunction<typeof getRouteEngine>;

function authenticate({ demo = false }: { demo?: boolean } = {}) {
  useAuthStore.setState({ isAuthenticated: true, isDemoMode: demo });
}

describe('refreshWellness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, isDemoMode: false });
    syncWellnessNow.mockReturnValue(true);
    getSyncStatus.mockReturnValue({ state: 'idle' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetRouteEngine.mockReturnValue({ syncWellnessNow, getSyncStatus } as any);
  });

  it('asks Rust for the trailing window when authenticated', () => {
    authenticate();
    expect(refreshWellness()).toBe(true);
    expect(syncWellnessNow).toHaveBeenCalledWith(14);
  });

  it('passes an explicit window through', () => {
    authenticate();
    refreshWellness(370);
    expect(syncWellnessNow).toHaveBeenCalledWith(370);
  });

  it('stays silent when logged out', () => {
    expect(refreshWellness()).toBe(false);
    expect(syncWellnessNow).not.toHaveBeenCalled();
  });

  it('stays silent in demo mode, which holds no credential', () => {
    authenticate({ demo: true });
    expect(refreshWellness()).toBe(false);
    expect(syncWellnessNow).not.toHaveBeenCalled();
  });

  it('reports false rather than throwing when the engine is absent', () => {
    authenticate();
    mockGetRouteEngine.mockReturnValue(null);
    expect(refreshWellness()).toBe(false);
  });

  it('reports false rather than throwing when the FFI call fails', () => {
    authenticate();
    syncWellnessNow.mockImplementation(() => {
      throw new Error('engine gone');
    });
    expect(refreshWellness()).toBe(false);
  });

  it('reports false when a sync is already running', () => {
    authenticate();
    syncWellnessNow.mockReturnValue(false);
    expect(refreshWellness()).toBe(false);
  });
});

describe('refreshWellnessAndWait', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
    syncWellnessNow.mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetRouteEngine.mockReturnValue({ syncWellnessNow, getSyncStatus } as any);
  });

  it('resolves once the service leaves the syncing state', async () => {
    getSyncStatus
      .mockReturnValueOnce({ state: 'syncing' })
      .mockReturnValueOnce({ state: 'syncing' })
      .mockReturnValue({ state: 'idle' });

    await expect(refreshWellnessAndWait()).resolves.toBe(true);
    expect(getSyncStatus.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('gives up rather than hanging when the sync never settles', async () => {
    getSyncStatus.mockReturnValue({ state: 'syncing' });
    await expect(refreshWellnessAndWait(600)).resolves.toBe(false);
  });

  it('does not wait at all when the sync never started', async () => {
    syncWellnessNow.mockReturnValue(false);
    await expect(refreshWellnessAndWait()).resolves.toBe(false);
    expect(getSyncStatus).not.toHaveBeenCalled();
  });
});
