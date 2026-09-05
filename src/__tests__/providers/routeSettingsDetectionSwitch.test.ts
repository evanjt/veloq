/**
 * Scenario: the athlete turns section detection off.
 *
 * Expected behaviour: the engine hears about it. The switch used to live in
 * TypeScript alone, so Rust kept starting a conditioning detect at the end of
 * every stored batch and the screens merely looked away (`B258`). `Q61` leans
 * on this being the honest opt-out.
 */

import {
  useRouteSettings,
  isRouteMatchingEnabled,
} from '@/features/routes/stores/RouteSettingsStore';

const mockEngine = {
  setSetting: jest.fn(),
  getSetting: jest.fn(() => undefined),
  clearRoutesAndSections: jest.fn(),
  triggerRefresh: jest.fn(),
};

jest.mock('@/shared/native/engine', () => ({ getEngine: () => mockEngine }));

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => undefined),
}));

const DETECTION_KEY = '__detection_enabled';

describe('the detection switch reaches the engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useRouteSettings.setState({
      settings: {
        enabled: true,
        retentionDays: 0,
        autoCleanupEnabled: false,
        heatmapEnabled: true,
      },
      isLoaded: true,
    });
  });

  it('writes the switch off to the engine', async () => {
    await useRouteSettings.getState().setEnabled(false);

    expect(mockEngine.setSetting).toHaveBeenCalledWith(DETECTION_KEY, '0');
  });

  it('writes the switch back on', async () => {
    await useRouteSettings.getState().setEnabled(true);

    expect(mockEngine.setSetting).toHaveBeenCalledWith(DETECTION_KEY, '1');
  });

  it('still clears the catalogue when it is turned off', async () => {
    await useRouteSettings.getState().setEnabled(false);

    expect(mockEngine.clearRoutesAndSections).toHaveBeenCalledTimes(1);
  });

  it('leaves the catalogue alone when it is turned on', async () => {
    await useRouteSettings.getState().setEnabled(true);

    expect(mockEngine.clearRoutesAndSections).not.toHaveBeenCalled();
  });

  it('tells the engine before it asks for a refresh, so no detect slips through', async () => {
    await useRouteSettings.getState().setEnabled(true);

    expect(mockEngine.setSetting.mock.invocationCallOrder[0]).toBeLessThan(
      mockEngine.triggerRefresh.mock.invocationCallOrder[0]
    );
  });

  it('keeps the local read in step with what it wrote', async () => {
    await useRouteSettings.getState().setEnabled(false);
    expect(isRouteMatchingEnabled()).toBe(false);

    await useRouteSettings.getState().setEnabled(true);
    expect(isRouteMatchingEnabled()).toBe(true);
  });
});
