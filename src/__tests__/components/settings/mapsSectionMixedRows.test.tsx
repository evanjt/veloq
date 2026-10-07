/**
 * Scenario: per-type map choices saved under an older grouping put Hike and
 * Snowshoe in one row with different terrain modes, and Gym's members on
 * different styles.
 *
 * Expected behaviour: the row says Mixed for each column that disagrees, opening
 * the screen writes nothing, and only an explicit tap applies one value to
 * every member.
 */

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { MapPreferencesProvider, useMapPreferences } from '@/features/maps';
import { MapsSection } from '@/features/settings/components/MapsSection';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockStore = new Map<string, string>();
const mockSetSetting = jest.fn(async (key: string, value: string) => {
  mockStore.set(key, value);
});
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setSetting: (key: string, value: string) => mockSetSetting(key, value),
  removeSetting: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

const PREFS_KEY = 'veloq-map-preferences';

function seed(prefs: Record<string, unknown>) {
  mockStore.set(
    PREFS_KEY,
    JSON.stringify({
      defaultStyle: 'light',
      activityTypeStyles: {},
      terrain3DMode: 'smart',
      terrain3DModeByType: {},
      ...prefs,
    })
  );
}

function saved() {
  return JSON.parse(mockStore.get(PREFS_KEY)!);
}

function Gate() {
  const { isLoaded } = useMapPreferences();
  return isLoaded ? <MapsSection /> : null;
}

const screen = () => (
  <MapPreferencesProvider>
    <Gate />
  </MapPreferencesProvider>
);

const GYM_SATELLITE = {
  Workout: 'satellite',
  WeightTraining: 'satellite',
  Yoga: 'satellite',
  Other: 'satellite',
};

beforeEach(() => {
  mockStore.clear();
  mockSetSetting.mockClear();
});

describe('map style rows over split saved values', () => {
  it('writes nothing on mount, rerender or remount and keeps Snowshoe on always', async () => {
    seed({ terrain3DModeByType: { Hike: 'off', Snowshoe: 'always' } });
    const before = mockStore.get(PREFS_KEY);

    const first = render(screen());
    await waitFor(() => expect(first.getByTestId('map-terrain-pill-Hike')).toBeTruthy());
    first.rerender(screen());
    first.unmount();
    const second = render(screen());
    await waitFor(() => expect(second.getByTestId('map-terrain-pill-Hike')).toBeTruthy());
    await act(async () => {});

    expect(mockSetSetting).not.toHaveBeenCalled();
    expect(mockStore.get(PREFS_KEY)).toBe(before);
    expect(saved().terrain3DModeByType.Snowshoe).toBe('always');
  });

  it('shows Mixed per column and taps one column at a time', async () => {
    seed({
      activityTypeStyles: GYM_SATELLITE,
      terrain3DModeByType: { Hike: 'off', Snowshoe: 'always' },
    });
    const view = render(screen());
    await waitFor(() => expect(view.getByTestId('map-terrain-pill-Hike')).toBeTruthy());

    expect(view.getAllByText(/settings\.mixed/).length).toBeGreaterThan(0);
    expect(view.getByTestId('map-style-pill-Hike')).toHaveTextContent('settings.default');
    expect(view.getByTestId('map-style-pill-Gym')).toHaveTextContent('settings.mixed');
    expect(view.getByTestId('map-terrain-pill-Gym')).toHaveTextContent(
      '3D: settings.terrain3DSmart'
    );
    expect(view.getByTestId('map-terrain-pill-Hike')).toHaveTextContent('3D: settings.mixed');

    await act(async () => {
      fireEvent.press(view.getByTestId('map-terrain-pill-Hike'));
    });
    const afterTerrain = saved();
    expect(afterTerrain.terrain3DModeByType).toEqual({});
    expect(afterTerrain.activityTypeStyles).toEqual(GYM_SATELLITE);
    expect(view.getByTestId('map-terrain-pill-Hike')).toHaveTextContent(
      '3D: settings.terrain3DSmart'
    );
    expect(view.getByTestId('map-style-pill-Gym')).toHaveTextContent('settings.mixed');

    await act(async () => {
      fireEvent.press(view.getByTestId('map-style-pill-Gym'));
    });
    const afterStyle = saved();
    const gymStyles = Object.keys(GYM_SATELLITE).filter((tp) => tp !== 'Other');
    const styles = new Set(gymStyles.map((tp) => afterStyle.activityTypeStyles[tp]));
    expect(styles.size).toBe(1);
    expect(afterStyle.terrain3DModeByType).toEqual(afterTerrain.terrain3DModeByType);
    expect(afterStyle.activityTypeStyles.Other).toBe('satellite');
    expect(view.getByTestId('map-style-pill-Gym')).not.toHaveTextContent('settings.mixed');
  });
});
