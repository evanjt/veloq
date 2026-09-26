/**
 * Scenario: the section detail map draws a dashed line and two endpoint dots
 * for every section near this one, and says nowhere what they are. Read beside
 * the activity Sections tab, which answers a different question with a
 * different query, the dots look like the sections this activity covered, so
 * the parts of the route without a dot look uncovered. They are not.
 *
 * Expected behaviour: the map names its layers, in the same register as
 * `ScatterLegend`, and says nothing when there is nothing nearby to name.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initializeI18n, changeLanguage } from '@/i18n';
import { SectionMapView } from '@/features/routes/components/SectionMapView';
import type { NearbyPolyline } from '@/features/routes/components/useSectionMapLayers';
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
}));

jest.mock('expo-location', () => ({
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
  sportType: 'Ride',
  polyline: POLYLINE,
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 7,
  createdAt: '2026-01-15T10:00:00Z',
};

function nearby(id: string): NearbyPolyline {
  return {
    id,
    name: `Section ${id}`,
    sportType: 'Ride',
    distanceMeters: 300,
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

describe('the section detail map names what it draws', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  beforeEach(async () => {
    await changeLanguage('en-AU');
  });

  it('names the nearby layer, so its dots do not read as this activity', () => {
    renderMap({ nearbyPolylines: [nearby('a'), nearby('b')] });

    expect(screen.getByTestId('section-map-legend')).toBeTruthy();
    expect(screen.getByText('This section')).toBeTruthy();
    expect(screen.getByText('Other sections nearby')).toBeTruthy();
  });

  it('says nothing when there is nothing nearby to name', () => {
    renderMap({ nearbyPolylines: [] });

    expect(screen.queryByTestId('section-map-legend')).toBeNull();
  });

  it('says nothing when the caller passes no nearby sections at all', () => {
    renderMap();

    expect(screen.queryByTestId('section-map-legend')).toBeNull();
  });

  it('stays out of the preview form, which carries no controls', () => {
    renderMap({ interactive: false, nearbyPolylines: [nearby('a')] });

    expect(screen.queryByTestId('section-map-legend')).toBeNull();
  });
});
