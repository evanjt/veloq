/**
 * Scenario: the athlete turns route matching off, which wipes the derived
 * catalogue.
 *
 * Expected behaviour: the wipe runs on a Rust thread, not the JS thread.
 * Measured at a 750-activity library it takes 367 ms, and it used to run under
 * the engine write lock on the thread that paints, so a switch the athlete
 * flipped froze the app. The refresh still waits for the wipe to settle, or
 * the screens would read a catalogue that is still draining.
 */

import { useRouteSettings } from '@/features/routes/stores/RouteSettingsStore';

const mockEngine = {
  setSetting: jest.fn(),
  getSetting: jest.fn(() => undefined),
  clearRoutesAndSections: jest.fn(),
  runClearRoutesAndSections: jest.fn(() => Promise.resolve()),
  triggerRefresh: jest.fn(),
};

jest.mock('@/shared/native/engine', () => ({ getEngine: () => mockEngine }));

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => undefined),
}));

describe('the catalogue wipe is off the JS thread', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEngine.runClearRoutesAndSections.mockResolvedValue(undefined);
    useRouteSettings.setState({
      settings: { enabled: true, autoCleanupEnabled: false },
      isLoaded: true,
      clearNotice: null,
    });
  });

  it('starts the wipe on a thread instead of running it here', async () => {
    await useRouteSettings.getState().setEnabled(false);

    expect(mockEngine.runClearRoutesAndSections).toHaveBeenCalledTimes(1);
    expect(mockEngine.clearRoutesAndSections).not.toHaveBeenCalled();
  });

  it('waits for the wipe to settle before asking for a refresh', async () => {
    let settled = false;
    mockEngine.runClearRoutesAndSections.mockImplementation(async () => {
      await Promise.resolve();
      settled = true;
    });

    await useRouteSettings.getState().setEnabled(false);

    expect(settled).toBe(true);
    expect(mockEngine.runClearRoutesAndSections.mock.invocationCallOrder[0]).toBeLessThan(
      mockEngine.triggerRefresh.mock.invocationCallOrder[0]
    );
  });

  it('starts nothing when the switch goes on', async () => {
    await useRouteSettings.getState().setEnabled(true);

    expect(mockEngine.runClearRoutesAndSections).not.toHaveBeenCalled();
    expect(mockEngine.triggerRefresh).toHaveBeenCalled();
  });

  it('records a wipe still running past the wait, and refreshes anyway', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    mockEngine.runClearRoutesAndSections.mockReturnValue(new Promise<void>(() => {}));

    const flipped = useRouteSettings.getState().setEnabled(false);
    await jest.advanceTimersByTimeAsync(70_000);
    await flipped;
    jest.useRealTimers();

    expect(useRouteSettings.getState().clearNotice).toBe('settings.stillRunning');
    expect(mockEngine.triggerRefresh).toHaveBeenCalled();
  });

  it('leaves the notice off when the wipe lands inside the wait', async () => {
    await useRouteSettings.getState().setEnabled(false);

    expect(useRouteSettings.getState().clearNotice).toBeNull();
  });

  it('still refreshes when the wipe fails, so the switch is never stuck', async () => {
    mockEngine.runClearRoutesAndSections.mockRejectedValue(new Error('disk went away'));

    await expect(useRouteSettings.getState().setEnabled(false)).resolves.toBeUndefined();
    expect(mockEngine.triggerRefresh).toHaveBeenCalled();
  });

  /**
   * The distinction the untyped catch could not make: the engine refusing and
   * this side giving up were one message, and the athlete was told neither.
   */
  it('names the engine failure rather than the notice for a stopped wait', async () => {
    mockEngine.runClearRoutesAndSections.mockRejectedValue(
      Object.assign(new Error('Database error: disk I/O error'), {
        tag: 'Database',
        inner: { msg: 'disk I/O error' },
      })
    );

    await useRouteSettings.getState().setEnabled(false);

    expect(useRouteSettings.getState().clearNotice).toBe('engine.failure.database');
  });

  it('tells a closed engine from a failed database', async () => {
    mockEngine.runClearRoutesAndSections.mockRejectedValue(
      Object.assign(new Error('Engine not initialised'), { tag: 'NotInitialized' })
    );

    await useRouteSettings.getState().setEnabled(false);

    expect(useRouteSettings.getState().clearNotice).toBe('engine.failure.notOpen');
  });

  it('leaves a failure that is not the engine on the general wording', async () => {
    mockEngine.runClearRoutesAndSections.mockRejectedValue(new Error('disk went away'));

    await useRouteSettings.getState().setEnabled(false);

    expect(useRouteSettings.getState().clearNotice).toBe('alerts.failedToClear');
  });
});
