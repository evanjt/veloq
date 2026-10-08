/**
 * Scenario: the App Tour's map slide is shown, and its Show Me is tapped.
 *
 * Expected behaviour: the default map style stays what it was, light on a new
 * install and the athlete's own choice once they have made one. The slide
 * offers the picker; it never chooses for them.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { MapPreferencesSlide } from '@/features/settings/components/whatsNew/MapPreferencesSlide';
import { WhatsNewModal } from '@/features/settings/components/whatsNew/WhatsNewModal';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import {
  MapPreferencesProvider,
  useMapPreferences,
} from '@/features/settings/stores/MapPreferencesContext';
import { useAuthStore } from '@/shared/app/AuthStore';
import { getSetting, setSetting } from '@/shared/storage';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
  removeSetting: jest.fn(async () => {}),
}));

jest.mock('@/shared/app/navigation', () => ({
  ...jest.requireActual('@/shared/app/navigation'),
  navigateTab: jest.fn(),
}));

jest.mock('@/features/settings/components/MapStylePreviewPicker', () => ({
  MapStylePreviewPicker: () => null,
}));

jest.mock('@/features/settings/components/whatsNew/WhatsNewSlide', () => ({
  WhatsNewSlide: () => null,
}));

const mockGetSetting = getSetting as jest.Mock;
const mockSetSetting = setSetting as jest.Mock;

/** Every map preferences object written to storage. */
function written(): { defaultStyle: string; terrain3DMode: string }[] {
  return mockSetSetting.mock.calls
    .filter(([key]) => key === 'veloq-map-preferences')
    .map(([, value]) => JSON.parse(value));
}

type Preferences = ReturnType<typeof useMapPreferences>;
let current: Preferences | null = null;
function see(value: Preferences) {
  current = value;
}
function Probe({ onValue }: { onValue: (value: Preferences) => void }) {
  onValue(useMapPreferences());
  return null;
}

function storedPreferences(defaultStyle: string) {
  mockGetSetting.mockImplementation(async (key: string) =>
    key === 'veloq-map-preferences'
      ? JSON.stringify({ defaultStyle, activityTypeStyles: {}, terrain3DMode: 'off' })
      : null
  );
}

beforeEach(() => {
  current = null;
  mockSetSetting.mockClear();
  mockGetSetting.mockImplementation(async () => null);
});

describe('the tour map slide', () => {
  it('leaves a new install on the light style', async () => {
    render(
      <MapPreferencesProvider>
        <Probe onValue={see} />
        <MapPreferencesSlide />
      </MapPreferencesProvider>
    );
    await waitFor(() => expect(current?.isLoaded).toBe(true));
    expect(current!.preferences.defaultStyle).toBe('light');
    expect(current!.getStyleForActivity('Ride', 'a1')).toBe('light');
    expect(written()).toEqual([]);
  });

  it('leaves a style the athlete chose, and their terrain choice, alone', async () => {
    storedPreferences('dark');
    render(
      <MapPreferencesProvider>
        <Probe onValue={see} />
        <MapPreferencesSlide />
      </MapPreferencesProvider>
    );
    await waitFor(() => expect(current?.isLoaded).toBe(true));
    expect(current!.preferences.defaultStyle).toBe('dark');
    expect(current!.preferences.terrain3DMode).toBe('off');
    expect(written()).toEqual([]);
  });
});

describe('Show Me on the tour map slide', () => {
  it('opens the map without changing the chosen style', async () => {
    storedPreferences('dark');
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
    useWhatsNewStore.setState({ isLoaded: true, lastSeenVersion: null, tourState: null });
    render(
      <MapPreferencesProvider>
        <Probe onValue={see} />
        <WhatsNewModal />
      </MapPreferencesProvider>
    );
    await waitFor(() => expect(current?.isLoaded).toBe(true));
    expect(useWhatsNewStore.getState().tourState?.mode).toBe('tutorial');

    await act(async () => {
      fireEvent.press(screen.getByText('whatsNew.showMeButton'));
    });

    expect(useWhatsNewStore.getState().tourState?.exploring).toBeTruthy();
    expect(current!.preferences.defaultStyle).toBe('dark');
    expect(current!.preferences.terrain3DMode).toBe('off');
    expect(written()).toEqual([]);
  });
});
