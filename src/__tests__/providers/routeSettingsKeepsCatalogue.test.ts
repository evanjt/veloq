/**
 * Scenario: the athlete turns route matching off for a while, then on again.
 *
 * Expected behaviour: off stops detection and refreshes the screens, and wipes
 * nothing. The auto-detected sections keep their ids and lap history, so the
 * switch coming back on resumes over the same catalogue. Removing them is
 * Clear cache's job.
 */

import { useRouteSettings } from '@/features/routes/stores/RouteSettingsStore';

const mockEngine = {
  setSetting: jest.fn(),
  getSetting: jest.fn(() => undefined),
  runClearDerived: jest.fn(),
  triggerRefresh: jest.fn(),
};

jest.mock('@/shared/native/engine', () => ({ getEngine: () => mockEngine }));

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => undefined),
}));

describe('turning route matching off keeps the catalogue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useRouteSettings.setState({
      settings: { enabled: true },
      isLoaded: true,
    });
  });

  it('starts no wipe when the switch goes off', async () => {
    await useRouteSettings.getState().setEnabled(false);

    expect(mockEngine.runClearDerived).not.toHaveBeenCalled();
  });

  it('still tells the engine and refreshes the screens', async () => {
    await useRouteSettings.getState().setEnabled(false);

    expect(mockEngine.setSetting).toHaveBeenCalledWith('__detection_enabled', '0');
    expect(mockEngine.triggerRefresh).toHaveBeenCalledWith('sections');
    expect(mockEngine.triggerRefresh).toHaveBeenCalledWith('groups');
  });

  it('starts no wipe over an off and on cycle', async () => {
    await useRouteSettings.getState().setEnabled(false);
    await useRouteSettings.getState().setEnabled(true);

    expect(mockEngine.triggerRefresh).toHaveBeenCalledWith('activities');
  });
});
