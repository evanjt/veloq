/**
 * Scenario: the athlete turns section detection off.
 *
 * Expected behaviour: the engine hears about it. The switch used to live in
 * TypeScript alone, so Rust kept starting a conditioning detect at the end of
 * every stored batch and the screens merely looked away. This switch is the
 * honest opt-out, so it has to reach the engine.
 */

import {
  useRouteSettings,
  isRouteMatchingEnabled,
  initializeRouteSettings,
} from '@/features/routes/stores/RouteSettingsStore';

import { getSetting } from '@/shared/storage';

const mockEngine = {
  setSetting: jest.fn(),
  getSetting: jest.fn<string | undefined, [string]>(() => undefined),
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
    mockEngine.getSetting.mockReturnValue(undefined);
    jest.mocked(getSetting).mockResolvedValue(null);
    useRouteSettings.setState({
      settings: {
        enabled: true,
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

describe('loading the saved detection switch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEngine.getSetting.mockReturnValue(undefined);
    useRouteSettings.setState({
      settings: { enabled: true },
      isLoaded: false,
    });
  });

  it.each([
    [false, undefined, '0'],
    [false, '1', '0'],
    [true, '0', '1'],
  ])('reconciles enabled=%s with engine value %s', async (enabled, stored, expected) => {
    jest.mocked(getSetting).mockResolvedValue(JSON.stringify({ enabled }));
    mockEngine.getSetting.mockReturnValue(stored);

    await initializeRouteSettings();

    expect(mockEngine.setSetting).toHaveBeenCalledWith(DETECTION_KEY, expected);
    expect(isRouteMatchingEnabled()).toBe(enabled);
    expect(mockEngine.triggerRefresh).not.toHaveBeenCalled();
  });

  it('does not rewrite an engine value already in agreement on repeated loads', async () => {
    jest.mocked(getSetting).mockResolvedValue(JSON.stringify({ enabled: false }));
    mockEngine.getSetting.mockReturnValue('0');

    await initializeRouteSettings();
    await initializeRouteSettings();

    expect(mockEngine.setSetting).not.toHaveBeenCalled();
  });

  it.each([null, '{}', 'invalid json'])('seeds the default for %s', async (stored) => {
    jest.mocked(getSetting).mockResolvedValue(stored);

    await initializeRouteSettings();

    expect(mockEngine.setSetting).toHaveBeenCalledWith(DETECTION_KEY, '1');
  });

  it('still loads the preference when the engine write throws', async () => {
    jest.mocked(getSetting).mockResolvedValue(JSON.stringify({ enabled: false }));
    mockEngine.setSetting.mockImplementationOnce(() => {
      throw new Error('unavailable');
    });

    await initializeRouteSettings();

    expect(isRouteMatchingEnabled()).toBe(false);
    expect(useRouteSettings.getState().isLoaded).toBe(true);
  });
});
