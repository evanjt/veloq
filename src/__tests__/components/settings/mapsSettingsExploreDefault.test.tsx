/**
 * Scenario: the map's own style button saved satellite as the Explore Map style,
 * and the athlete wants the map to follow their default style again.
 *
 * Expected behaviour: the Explore Map control offers Default beside every
 * style, Default clears the saved choice so the map follows the default style,
 * and the screen does not repeat its own title as a section label.
 */

import React from 'react';
import { act, fireEvent, render, waitFor, type RenderAPI } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { PaperProvider } from 'react-native-paper';

import { MapPreferencesProvider, useMapPreferences } from '@/features/settings';
import { MapsSection } from '@/features/settings/components/MapsSection';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockStore = new Map<string, string>();
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  removeSetting: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

const PREFS_KEY = 'veloq-map-preferences';

function seed(prefs: Record<string, unknown>) {
  mockStore.set(
    PREFS_KEY,
    JSON.stringify({
      defaultStyle: 'dark',
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

function ExploreStyleProbe() {
  const { getGlobalMapStyle, setDefaultStyle } = useMapPreferences();
  return (
    <>
      <Text testID="explore-style">{getGlobalMapStyle()}</Text>
      <Pressable testID="default-to-satellite" onPress={() => setDefaultStyle('satellite')} />
    </>
  );
}

function Gate() {
  const { isLoaded } = useMapPreferences();
  return isLoaded ? (
    <>
      <MapsSection />
      <ExploreStyleProbe />
    </>
  ) : null;
}

const screen = () => (
  <PaperProvider>
    <MapPreferencesProvider>
      <Gate />
    </MapPreferencesProvider>
  </PaperProvider>
);

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
});

describe('maps settings screen title', () => {
  it('leaves the title to the header and prints no section label of the same name', async () => {
    seed({});
    const view = render(screen());
    await waitFor(() => expect(view.getByTestId('map-style-pill-explore')).toBeTruthy());

    expect(view.queryByText('settings.maps')).toBeNull();
  });
});

describe('the Explore Map style override', () => {
  it('shows Default when the map has no style of its own', async () => {
    seed({});
    const view = render(screen());
    await waitFor(() => expect(view.getByTestId('map-style-pill-explore')).toBeTruthy());

    expect(view.getByTestId('map-style-pill-explore')).toHaveTextContent('settings.default');
    expect(view.getByTestId('explore-style')).toHaveTextContent('dark');
  });

  it('chooses Default over satellite, which clears the override and follows the default style', async () => {
    seed({ globalMapStyle: 'satellite' });
    const view = render(screen());
    await waitFor(() => expect(view.getByTestId('map-style-pill-explore')).toBeTruthy());
    expect(view.getByTestId('map-style-pill-explore')).toHaveTextContent('settings.satellite');
    expect(view.getByTestId('explore-style')).toHaveTextContent('satellite');

    await choose(view, 'map-style-pill-explore', 'settings.default');

    expect(view.getByTestId('map-style-pill-explore')).toHaveTextContent('settings.default');
    expect(saved()).not.toHaveProperty('globalMapStyle');
    expect(view.getByTestId('explore-style')).toHaveTextContent('dark');

    await act(async () => {
      await fireEvent.press(view.getByTestId('default-to-satellite'));
    });
    expect(view.getByTestId('explore-style')).toHaveTextContent('satellite');
    expect(view.getByTestId('map-style-pill-explore')).toHaveTextContent('settings.default');
  });

  it('sets an override again when a style is chosen over Default', async () => {
    seed({});
    const view = render(screen());
    await waitFor(() => expect(view.getByTestId('map-style-pill-explore')).toBeTruthy());

    await choose(view, 'map-style-pill-explore', 'settings.light');

    expect(view.getByTestId('map-style-pill-explore')).toHaveTextContent('settings.light');
    expect(saved().globalMapStyle).toBe('light');
    expect(view.getByTestId('explore-style')).toHaveTextContent('light');
  });

  it('keeps the override the map writes after a reload', async () => {
    seed({ globalMapStyle: 'light' });
    const view = render(screen());
    await waitFor(() => expect(view.getByTestId('map-style-pill-explore')).toBeTruthy());

    expect(view.getByTestId('map-style-pill-explore')).toHaveTextContent('settings.light');
    expect(view.getByTestId('explore-style')).toHaveTextContent('light');
  });
});
