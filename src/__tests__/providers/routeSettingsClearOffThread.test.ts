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
  startClearRoutesAndSections: jest.fn(),
  pollClearRoutesAndSections: jest.fn(() => 'complete'),
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
    mockEngine.pollClearRoutesAndSections.mockReturnValue('complete');
    useRouteSettings.setState({
      settings: { enabled: true, autoCleanupEnabled: false },
      isLoaded: true,
    });
  });

  it('starts the wipe on a thread instead of running it here', async () => {
    await useRouteSettings.getState().setEnabled(false);

    expect(mockEngine.startClearRoutesAndSections).toHaveBeenCalledTimes(1);
    expect(mockEngine.clearRoutesAndSections).not.toHaveBeenCalled();
  });

  it('waits for the wipe to settle before asking for a refresh', async () => {
    mockEngine.pollClearRoutesAndSections
      .mockReturnValueOnce('running')
      .mockReturnValueOnce('complete');

    await useRouteSettings.getState().setEnabled(false);

    expect(mockEngine.pollClearRoutesAndSections).toHaveBeenCalledTimes(2);
    expect(mockEngine.startClearRoutesAndSections.mock.invocationCallOrder[0]).toBeLessThan(
      mockEngine.triggerRefresh.mock.invocationCallOrder[0]
    );
  });

  it('starts nothing when the switch goes on', async () => {
    await useRouteSettings.getState().setEnabled(true);

    expect(mockEngine.startClearRoutesAndSections).not.toHaveBeenCalled();
    expect(mockEngine.triggerRefresh).toHaveBeenCalled();
  });

  it('still refreshes when the wipe fails, so the switch is never stuck', async () => {
    mockEngine.pollClearRoutesAndSections.mockImplementation(() => {
      throw new Error('disk went away');
    });

    await expect(useRouteSettings.getState().setEnabled(false)).resolves.toBeUndefined();
    expect(mockEngine.triggerRefresh).toHaveBeenCalled();
  });
});
