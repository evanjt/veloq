/**
 * Scenario: a settings screen opened under its title, then drew the same words
 * again as the header of its first group, so the athlete read "Display" over
 * "DISPLAY".
 *
 * Expected behaviour: no settings screen's content carries a group header that
 * repeats the title its native header already shows.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DisplaySettings } from '@/features/settings/components/DisplaySettings';
import { MapsSection } from '@/features/settings/components/MapsSection';
import {
  MapPreferencesProvider,
  useMapPreferences,
} from '@/features/settings/stores/MapPreferencesContext';
import { NotificationSection } from '@/features/settings/components/NotificationSection';
import { SummaryCardSection } from '@/features/settings/components/SummaryCardSection';
import { SCREEN_HEADERS } from '@/shared/app/screenHeaders';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
  removeSetting: jest.fn(async () => {}),
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/features/stats', () => ({ usePaceCurve: () => ({ data: undefined }) }));

function LoadedMaps() {
  const { isLoaded } = useMapPreferences();
  return isLoaded ? <MapsSection /> : null;
}

const SPOKES: [route: string, element: () => React.ReactElement][] = [
  [
    'display-settings',
    () => (
      <DisplaySettings
        themePreference="system"
        onThemeChange={jest.fn()}
        unitPreference="metric"
        onUnitChange={jest.fn()}
        intervalsUnitPreference={null}
        primarySport="Running"
        onSportChange={jest.fn()}
        language="en-GB"
        onLanguageChange={jest.fn()}
      />
    ),
  ],
  [
    'map-settings',
    () => (
      <MapPreferencesProvider>
        <LoadedMaps />
      </MapPreferencesProvider>
    ),
  ],
  ['summary-card-settings', () => <SummaryCardSection />],
  ['notification-settings', () => <NotificationSection />],
];

describe('settings screens do not repeat their title', () => {
  it.each(SPOKES)('%s draws no group header equal to its title', async (route, element) => {
    const titleKey = SCREEN_HEADERS[route]?.titleKey;
    expect(titleKey).toBeDefined();

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const screen = await render(
      <QueryClientProvider client={client}>{element()}</QueryClientProvider>
    );

    await waitFor(() => expect(screen.toJSON()).not.toBeNull());
    const headers = screen.queryAllByRole('header').map((node) => node.props.children);
    expect(headers).not.toContain(titleKey);
  });
});
