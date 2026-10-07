/**
 * Scenario: satellite is chosen for a sport, then the radio goes off.
 *
 * Expected behaviour: the inline section and route detail maps hand the
 * theme's vector basemap to their surface, and satellite again once online.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RouteMapView } from '@/features/routes/components/RouteMapView';
import { SectionMapView } from '@/features/routes/components/SectionMapView';
import type { FrequentSection, RoutePoint } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

let mockOnline = true;
const mockSurfaceStyles: string[] = [];
jest.mock('@/shared/app/NetworkContext', () => ({ useIsOnline: () => mockOnline }));
jest.mock('@/features/maps/components/MapSurface', () => {
  const actual = jest.requireActual('@/features/maps/components/MapSurface');
  const { View } = require('react-native');
  return {
    ...actual,
    MapSurface: (props: { mapStyle: string }) => {
      mockSurfaceStyles.push(props.mapStyle);
      return <View testID="surface" />;
    },
  };
});

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'satellite' },
    getStyleForActivity: () => 'satellite',
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

const POINTS: RoutePoint[] = [
  { lat: 46.948, lng: 7.447 },
  { lat: 46.949, lng: 7.448 },
  { lat: 46.95, lng: 7.449 },
  { lat: 46.951, lng: 7.45 },
];

const SECTION: FrequentSection = {
  id: 'section-1',
  sectionType: 'auto',
  name: 'Bern climb',
  sportTypes: ['Ride'],
  polyline: POINTS,
  distanceMeters: 1200,
  activityIds: ['a1', 'a2'],
  visitCount: 7,
  createdAt: '2026-01-15T10:00:00Z',
};

const ROUTE = {
  id: 'route-1',
  name: 'Morning loop',
  signature: { points: POINTS, distance: 4200 },
  activityIds: ['a1', 'a2'],
  activityCount: 2,
  type: 'Ride' as const,
};

// The stubbed connection is not a context, so a fresh prop is what re-renders the memoised view.
const views: Record<string, () => React.ReactElement> = {
  section: () => <SectionMapView section={{ ...SECTION }} />,
  route: () => <RouteMapView routeGroup={ROUTE} selectedSportType="Ride" />,
};

describe.each(Object.keys(views))('%s detail map offline style', (name) => {
  beforeEach(() => {
    mockOnline = true;
    mockSurfaceStyles.length = 0;
  });

  const tree = () => <SafeAreaProvider initialMetrics={METRICS}>{views[name]()}</SafeAreaProvider>;

  it('draws satellite online', () => {
    render(tree());
    expect(mockSurfaceStyles.at(-1)).toBe('satellite');
  });

  it('draws the vector basemap offline and satellite on return', () => {
    mockOnline = false;
    const { rerender } = render(tree());
    expect(mockSurfaceStyles.at(-1)).toBe('light');

    mockOnline = true;
    rerender(tree());
    expect(mockSurfaceStyles.at(-1)).toBe('satellite');
  });
});
