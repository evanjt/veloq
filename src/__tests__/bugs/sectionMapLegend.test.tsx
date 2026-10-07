/**
 * Scenario: the section detail map names only the layers drawn over the
 * section's own line, which needs no label.
 *
 * Expected behaviour: nothing draws or is named for neighbouring sections, and
 * the legend appears only when the highlighted activity, a ledger version or
 * the delta colouring is on the map.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initializeI18n, changeLanguage } from '@/i18n';
import { SectionMapView } from '@/features/routes/components/SectionMapView';
import type { FrequentSection, RoutePoint } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
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

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
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

function nearby(id: string) {
  return {
    id,
    name: `Section ${id}`,
    distanceMeters: 300,
    centerDistanceMeters: 120,
    visitCount: 2,
    encodedPolyline: new ArrayBuffer(8),
  };
}

function renderMap(props: Partial<React.ComponentProps<typeof SectionMapView>> = {}) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SectionMapView section={SECTION} interactive {...props} />
    </SafeAreaProvider>
  );
}

describe('the section detail map legend', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  beforeEach(async () => {
    await changeLanguage('en-AU');
  });

  it('draws no legend for the section alone', () => {
    renderMap();
    expect(screen.queryByTestId('section-map-legend')).toBeNull();
  });

  it('draws no nearby layer and no legend when neighbouring sections are passed', () => {
    renderMap({ nearbyPolylines: [nearby('a'), nearby('b')] } as never);

    expect(screen.queryByTestId('section-map-legend')).toBeNull();
    expect(screen.queryByText('Other sections nearby')).toBeNull();
    expect(screen.queryByText('This section')).toBeNull();
  });

  it('names only the highlighted lap when one is drawn', () => {
    renderMap({ highlightedLapPoints: POLYLINE });

    expect(screen.getByText('This activity')).toBeTruthy();
    expect(screen.queryByText('This section')).toBeNull();
    expect(screen.queryByText('Other sections nearby')).toBeNull();
  });

  it('names the shown ledger version, which draws as a grey line', () => {
    renderMap({
      shadowTrack: [
        [7.447, 46.948],
        [7.449, 46.95],
      ],
    });

    expect(screen.getByText('Earlier version')).toBeTruthy();
    expect(screen.queryByText('This activity')).toBeNull();
  });

  it('stays out of the preview form, which carries no controls', () => {
    renderMap({ interactive: false, highlightedLapPoints: POLYLINE });

    expect(screen.queryByTestId('section-map-legend')).toBeNull();
  });
});
