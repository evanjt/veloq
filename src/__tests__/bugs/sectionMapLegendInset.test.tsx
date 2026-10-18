/**
 * Scenario: the app draws edge to edge, so the section's map starts at
 * y = 0 and runs under the status bar and the transparent native header. The
 * legend and the map controls are positioned inside the map, so placed from a
 * guessed header row they sit partly under the bar, which takes the touches
 * there: 56 dp below the inset on Android.
 *
 * Expected behaviour: everything the map floats over its own top clears the
 * header's measured bottom edge.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SectionDetailMap } from '@/features/routes/components/SectionDetailMap';
import { detailCardWriter } from '@/features/routes/lib/detailCardState';
import { closeHost, openHost } from '@/shared/app/mapSheetHost';
import type { FrequentSection, RoutePoint } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getStyleForActivity: () => 'light',
  }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

// The map mounts once the screen has settled, which these cases take as done.
jest.mock('@/shared/async/useAfterNavigationTransition', () => ({
  useAfterNavigationTransition: (task: () => void) =>
    jest.requireActual('react').useEffect(task, [task]),
}));

jest.mock('@/features/routes/hooks/useSectionDetailData', () => ({
  useSectionDetailData: () => ({ data: null, allActivityTraces: undefined }),
}));

jest.mock('@/features/routes/hooks/useSectionDataRefresh', () => ({
  useSectionDataRefresh: () => ({ section: mockSection }),
}));

const INSET_TOP = 47;
const ANDROID_TOOLBAR_HEIGHT = 56;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: INSET_TOP, left: 0, right: 0, bottom: 34 },
};

const POLYLINE: RoutePoint[] = [
  { lat: 46.948, lng: 7.447 },
  { lat: 46.949, lng: 7.448 },
  { lat: 46.95, lng: 7.449 },
];

const mockSection: FrequentSection = {
  id: 'section-1',
  sectionType: 'auto',
  name: 'Bern climb',
  sportTypes: ['Ride'],
  polyline: POLYLINE,
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 7,
  createdAt: '2026-01-15T10:00:00Z',
};

beforeEach(() => {
  const key = openHost('section', mockSection.id);
  detailCardWriter(key).selectAttempt(null, POLYLINE);
});

afterEach(() => closeHost(`section:${mockSection.id}`));

function renderHeader(headerBottom: number) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={METRICS}>
        <HeaderHeightContext.Provider value={headerBottom}>
          <SectionDetailMap sectionId={mockSection.id} />
        </HeaderHeightContext.Provider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

function topOf(testID: string): number {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style).top;
}

describe('the section map keeps its overlays out from under the header', () => {
  const headerBottom = INSET_TOP + ANDROID_TOOLBAR_HEIGHT;

  it('drops the legend below the measured header', async () => {
    await renderHeader(headerBottom);

    expect(topOf('section-map-legend')).toBeGreaterThanOrEqual(headerBottom);
  });

  it('drops the map controls below the same edge, rather than a fixed guess', async () => {
    await renderHeader(headerBottom);

    expect(topOf('section-map-controls')).toBeGreaterThanOrEqual(headerBottom);
  });

  it('follows the header when it grows, as it does in a larger font', async () => {
    const tallHeader = headerBottom + 32;
    await renderHeader(tallHeader);

    expect(topOf('section-map-legend')).toBeGreaterThanOrEqual(tallHeader);
    expect(topOf('section-map-controls')).toBeGreaterThanOrEqual(tallHeader);
  });
});
