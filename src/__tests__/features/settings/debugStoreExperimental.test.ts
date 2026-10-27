/**
 * Scenario: the experimental switch and each feature's entry are settings.
 *
 * Expected behaviour: both are off at first and a feature never switched is on
 * under the master. A choice is stored, comes back after a relaunch, and a
 * damaged row reads as off.
 */

import { isExperimentalOn } from '@/features/settings/lib/experimental';
import { initialiseDebugStore, useDebugStore } from '@/features/settings/stores/DebugStore';
import { getSetting, setSetting } from '@/shared/storage';

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useDebugStore.setState({
    experimentalUnlocked: false,
    experimentalEnabled: false,
    experimentalFeatures: {},
    isLoaded: false,
  });
});

describe('the experimental switches in the debug store', () => {
  it('is off with nothing stored, and a feature needs the master switch and its own choice', () => {
    expect(
      isExperimentalOn({ experimentalEnabled: false, experimentalFeatures: {} }, 'garminUpdate')
    ).toBe(false);
    expect(
      isExperimentalOn({ experimentalEnabled: true, experimentalFeatures: {} }, 'garminUpdate')
    ).toBe(false);
    expect(
      isExperimentalOn(
        { experimentalEnabled: false, experimentalFeatures: { garminUpdate: true } },
        'garminUpdate'
      )
    ).toBe(false);
    expect(
      isExperimentalOn(
        { experimentalEnabled: true, experimentalFeatures: { garminUpdate: true } },
        'garminUpdate'
      )
    ).toBe(true);
    expect(
      isExperimentalOn(
        { experimentalEnabled: true, experimentalFeatures: { garminUpdate: false } },
        'garminUpdate'
      )
    ).toBe(false);
  });

  it('stores the master switch and each entry', async () => {
    await useDebugStore.getState().setExperimentalEnabled(true);
    await useDebugStore.getState().setExperimentalFeature('garminUpdate', false);

    expect(setSetting).toHaveBeenLastCalledWith(
      'veloq-experimental',
      JSON.stringify({ enabled: true, features: { garminUpdate: false } })
    );
  });

  it('reads the choices back on launch', async () => {
    (getSetting as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        JSON.stringify({ enabled: true, features: { efficiencyTrends: false, junk: 'x' } })
      );
    await initialiseDebugStore();

    const state = useDebugStore.getState();
    expect(state.experimentalEnabled).toBe(true);
    expect(state.experimentalUnlocked).toBe(true);
    expect(state.experimentalFeatures).toEqual({ efficiencyTrends: false });
  });

  it('reads a damaged row as off', async () => {
    (getSetting as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce('{not json');
    await initialiseDebugStore();

    expect(useDebugStore.getState().experimentalEnabled).toBe(false);
    expect(useDebugStore.getState().isLoaded).toBe(true);
  });
});
