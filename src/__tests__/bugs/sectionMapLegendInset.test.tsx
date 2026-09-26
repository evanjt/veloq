/**
 * Scenario: the app draws edge to edge, so the section hero's map starts at
 * y = 0 and runs under the status bar. Only the hero's floating header row
 * takes the top inset. The legend and the map controls are positioned inside
 * the map, so on a handset with a tall status bar the legend's first line sits
 * behind the clock and the rest of it under the back button.
 *
 * Expected behaviour: everything the map floats over its own top clears the
 * inset and the header row that carries the back button.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SectionHeader } from '@/features/routes/components/section/SectionHeader';
import { HERO_HEADER_HEIGHT } from '@/shared/ui';
import type { NearbyPolyline } from '@/features/routes/components/useSectionMapLayers';
import type { FrequentSection, RoutePoint } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

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
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

const INSET_TOP = 47;

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
  sportType: 'Ride',
  polyline: POLYLINE,
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 7,
  createdAt: '2026-01-15T10:00:00Z',
};

const NEARBY: NearbyPolyline[] = [
  {
    id: 'near-a',
    name: 'Section a',
    sportType: 'Ride',
    distanceMeters: 300,
    visitCount: 2,
    encodedPolyline: new ArrayBuffer(8),
  },
];

function renderHeader(insetTop: number) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SectionHeader
        section={SECTION}
        insetTop={insetTop}
        activityColor="#000000"
        iconName="bike"
        activityCount={7}
        mapReady={true}
        isTrimming={false}
        isExpandMode={false}
        trimStart={0}
        trimEnd={1}
        isEditing={false}
        editName=""
        customName={null}
        nameInputRef={React.createRef()}
        highlightedActivityId={null}
        nearbyPolylines={NEARBY}
        onBack={jest.fn()}
        onStartEditing={jest.fn()}
        onSaveName={jest.fn()}
        onCancelEdit={jest.fn()}
        onEditNameChange={jest.fn()}
      />
    </SafeAreaProvider>
  );
}

function topOf(testID: string): number {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style).top;
}

describe('the section map keeps its overlays out of the status bar', () => {
  it('drops the legend below the inset and the back button row', () => {
    renderHeader(INSET_TOP);

    expect(topOf('section-map-legend')).toBeGreaterThanOrEqual(INSET_TOP + HERO_HEADER_HEIGHT);
  });

  it('drops the map controls below the same row, rather than a fixed guess', () => {
    renderHeader(INSET_TOP);

    expect(topOf('section-map-controls')).toBeGreaterThanOrEqual(INSET_TOP + HERO_HEADER_HEIGHT);
  });

  it('still clears the back button row on a screen with no top inset', () => {
    renderHeader(0);

    expect(topOf('section-map-legend')).toBeGreaterThanOrEqual(HERO_HEADER_HEIGHT);
    expect(topOf('section-map-controls')).toBeGreaterThanOrEqual(HERO_HEADER_HEIGHT);
  });
});
