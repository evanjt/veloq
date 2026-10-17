/**
 * Scenario: the app draws edge to edge, so the section hero's map starts at
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

import { SectionHeader } from '@/features/routes/components/section/SectionHeader';
import { createMapHighlightStore } from '@/features/routes/lib/mapHighlight';
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

const SECTION: FrequentSection = {
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

function renderHeader(headerBottom: number) {
  const highlight = createMapHighlightStore();
  highlight.set(null, POLYLINE);
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <HeaderHeightContext.Provider value={headerBottom}>
        <SectionHeader
          section={SECTION}
          activityColor="#000000"
          iconName="bike"
          activityCount={7}
          mapReady={true}
          isTrimming={false}
          isExpandMode={false}
          trimStart={0}
          trimEnd={1}
          customName={null}
          highlight={highlight}
          onSaveName={jest.fn()}
        />
      </HeaderHeightContext.Provider>
    </SafeAreaProvider>
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
