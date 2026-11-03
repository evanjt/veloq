/**
 * Scenario: each experimental feature's entry is a setting, with no master switch.
 *
 * Expected behaviour: a feature is on exactly when its own choice is true. A choice is stored,
 * comes back after a relaunch, and a damaged row reads as off. A choice made under the retired
 * master switch folds into the choices on first read, so nothing turns on by itself.
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
  useDebugStore.setState({ experimentalFeatures: {}, isLoaded: false });
});

function stored(value: unknown) {
  (getSetting as jest.Mock)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(JSON.stringify(value));
}

describe('the experimental choices in the debug store', () => {
  it('is on exactly when the feature own choice is true', () => {
    expect(isExperimentalOn({ experimentalFeatures: {} }, 'garminUpdate')).toBe(false);
    expect(
      isExperimentalOn({ experimentalFeatures: { garminUpdate: false } }, 'garminUpdate')
    ).toBe(false);
    expect(isExperimentalOn({ experimentalFeatures: { garminUpdate: true } }, 'garminUpdate')).toBe(
      true
    );
    expect(
      isExperimentalOn({ experimentalFeatures: { garminUpdate: true } }, 'climbingBests')
    ).toBe(false);
  });

  it('stores each choice with no master flag', async () => {
    await useDebugStore.getState().setExperimentalFeature('garminUpdate', false);

    expect(setSetting).toHaveBeenLastCalledWith(
      'veloq-experimental',
      JSON.stringify({ features: { garminUpdate: false } })
    );
  });

  it('reads the choices back on launch', async () => {
    stored({ features: { efficiencyTrends: true, junk: 'x' } });
    await initialiseDebugStore();

    expect(useDebugStore.getState().experimentalFeatures).toEqual({ efficiencyTrends: true });
  });

  it('reads a choice stored under a master that was on as on', async () => {
    stored({ enabled: true, features: { garminUpdate: true, efficiencyTrends: false } });
    await initialiseDebugStore();

    expect(useDebugStore.getState().experimentalFeatures).toEqual({
      garminUpdate: true,
      efficiencyTrends: false,
    });
  });

  it('reads a choice stored under a master that was off as off, and writes the folded form back', async () => {
    stored({ enabled: false, features: { efficiencyTrends: true } });
    await initialiseDebugStore();

    expect(useDebugStore.getState().experimentalFeatures).toEqual({ efficiencyTrends: false });
    expect(setSetting).toHaveBeenCalledWith(
      'veloq-experimental',
      JSON.stringify({ features: { efficiencyTrends: false } })
    );
  });

  it('does not rewrite a row already in the folded form', async () => {
    stored({ features: { efficiencyTrends: true } });
    await initialiseDebugStore();

    expect(setSetting).not.toHaveBeenCalledWith('veloq-experimental', expect.anything());
  });

  it('reads a damaged row as off', async () => {
    (getSetting as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce('{not json');
    await initialiseDebugStore();

    expect(useDebugStore.getState().experimentalFeatures).toEqual({});
    expect(useDebugStore.getState().isLoaded).toBe(true);
  });
});
