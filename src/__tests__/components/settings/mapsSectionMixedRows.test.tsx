/**
 * Scenario: per-type map choices saved before families grouped the rows put Walk
 * and Hike in one row with different terrain modes, and Strength's members on
 * different styles.
 *
 * Expected behaviour: the row says Mixed for each column that disagrees, opening
 * the screen writes nothing, and only an explicit tap or choice applies one
 * value to every member.
 */

import React from 'react';
import { act, fireEvent, render, waitFor, type RenderAPI } from '@testing-library/react-native';

import { PaperProvider } from 'react-native-paper';

import { MapPreferencesProvider, useMapPreferences } from '@/features/settings';
import { MapsSection } from '@/features/settings/components/MapsSection';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, values?: { mode?: string }) =>
      key === 'settings.terrain3DMode' ? `Relief: ${values?.mode}` : key,
  }),
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
  <PaperProvider>
    <MapPreferencesProvider>
      <Gate />
    </MapPreferencesProvider>
  </PaperProvider>
);

const STRENGTH_SATELLITE = {
  Workout: 'satellite',
  WeightTraining: 'satellite',
  Yoga: 'satellite',
  Other: 'satellite',
};

/** Opens a style control and chooses one of its options by label. */
async function choose(view: RenderAPI, testID: string, option: string) {
  await act(async () => {
    await fireEvent.press(view.getByTestId(testID));
  });
  const row = await view.findByRole('menuitem', { name: option });
  await act(async () => {
    await fireEvent.press(row);
  });
}

beforeEach(() => {
  mockStore.clear();
  mockSetSetting.mockClear();
});

describe('map style rows over split saved values', () => {
  it('writes nothing on mount, rerender or remount and keeps Hike on always', async () => {
    seed({ terrain3DModeByType: { Walk: 'off', Hike: 'always' } });
    const before = mockStore.get(PREFS_KEY);

    const first = await render(screen());
    await waitFor(() => expect(first.getByTestId('map-terrain-pill-Foot')).toBeTruthy());
    await first.rerender(screen());
    await first.unmount();
    const second = await render(screen());
    await waitFor(() => expect(second.getByTestId('map-terrain-pill-Foot')).toBeTruthy());
    await act(async () => {});

    expect(mockSetSetting).not.toHaveBeenCalled();
    expect(mockStore.get(PREFS_KEY)).toBe(before);
    expect(saved().terrain3DModeByType.Hike).toBe('always');
  });

  it('shows Mixed per column and taps one column at a time', async () => {
    seed({
      activityTypeStyles: STRENGTH_SATELLITE,
      terrain3DModeByType: { Walk: 'off', Hike: 'always' },
    });
    const view = await render(screen());
    await waitFor(() => expect(view.getByTestId('map-terrain-pill-Foot')).toBeTruthy());

    expect(view.getAllByText(/settings\.mixed/).length).toBeGreaterThan(0);
    expect(view.getByTestId('map-style-pill-Foot')).toHaveTextContent('settings.default');
    expect(view.getByTestId('map-style-pill-Strength')).toHaveTextContent('settings.mixed');
    expect(view.getByTestId('map-terrain-pill-Strength')).toHaveTextContent(
      'Relief: settings.terrain3DSmart'
    );
    expect(view.getByTestId('map-terrain-pill-Foot')).toHaveTextContent('Relief: settings.mixed');

    await act(async () => {
      await fireEvent.press(view.getByTestId('map-terrain-pill-Foot'));
    });
    const afterTerrain = saved();
    expect(afterTerrain.terrain3DModeByType).toEqual({});
    expect(afterTerrain.activityTypeStyles).toEqual(STRENGTH_SATELLITE);
    expect(view.getByTestId('map-terrain-pill-Foot')).toHaveTextContent(
      'Relief: settings.terrain3DSmart'
    );
    expect(view.getByTestId('map-style-pill-Strength')).toHaveTextContent('settings.mixed');

    expect(view.getByTestId('map-style-pill-Strength').props.accessibilityLabel).toBe(
      'sportFamilies.strength: settings.mixed'
    );
    await choose(view, 'map-style-pill-Strength', 'settings.light');
    const afterStyle = saved();
    const strengthStyles = Object.keys(STRENGTH_SATELLITE).filter((tp) => tp !== 'Other');
    const styles = new Set(strengthStyles.map((tp) => afterStyle.activityTypeStyles[tp]));
    expect([...styles]).toEqual(['light']);
    expect(afterStyle.terrain3DModeByType).toEqual(afterTerrain.terrain3DModeByType);
    expect(afterStyle.activityTypeStyles.Other).toBe('satellite');
    expect(view.getByTestId('map-style-pill-Strength')).not.toHaveTextContent('settings.mixed');
  });

  it('shows the translated terrain mode in the badge and group rows', async () => {
    seed({});
    const view = await render(screen());
    await waitFor(() => expect(view.getByTestId('map-terrain-pill-Foot')).toBeTruthy());

    expect(view.getByLabelText('settings.terrain3D: settings.terrain3DSmart')).toHaveTextContent(
      'Relief: settings.terrain3DSmart'
    );
    expect(view.getByTestId('map-terrain-pill-Foot')).toHaveTextContent(
      'Relief: settings.terrain3DSmart'
    );
  });
});

describe('what a screen reader hears on a terrain pill', () => {
  it('names the sport beside the mode it draws, and says a tap changes it', async () => {
    seed({ terrain3DModeByType: { Walk: 'off', Hike: 'always' } });
    const view = render(screen());
    await waitFor(() => expect(view.getByTestId('map-terrain-pill-Foot')).toBeTruthy());

    const strength = view.getByTestId('map-terrain-pill-Strength');
    expect(strength.props.accessibilityLabel).toBe(
      'sportFamilies.strength, Relief: settings.terrain3DSmart'
    );
    expect(strength.props.accessibilityHint).toBe('a11y.cycleHint');
    expect(view.getByTestId('map-terrain-pill-Foot').props.accessibilityLabel).toBe(
      'sportFamilies.foot, Relief: settings.mixed'
    );
  });
});
