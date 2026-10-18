/**
 * Scenario: the section detail hero is a fraction of the window height, so on a short window it
 * is shorter than the five round buttons stacked from below the status bar and the header.
 *
 * Expected behaviour: the control column is bounded by the hero and wraps into further columns to
 * its left, drawn wide enough to hold them, so no button hangs past the map's bottom or right edge.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initialiseI18n } from '@/i18n';
import { SectionMapView } from '@/features/routes/components/SectionMapView';
import { MAP_CONTROL_GAP, MAP_CONTROL_SIZE } from '@/features/maps/components/MapControlButton';
import type { FrequentSection, RoutePoint } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

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

const INSET_TOP = 24;
const HEADER_BOTTOM = INSET_TOP + 56;
const METRICS = {
  frame: { x: 0, y: 0, width: 411, height: 701 },
  insets: { top: INSET_TOP, left: 0, right: 0, bottom: 0 },
};

const POLYLINE: RoutePoint[] = [
  { lat: 46.948, lng: 7.447 },
  { lat: 46.949, lng: 7.448 },
  { lat: 46.95, lng: 7.449 },
];

const SECTION: FrequentSection = {
  id: 'section-1',
  sectionType: 'auto',
  name: 'Harbour loop',
  sportTypes: ['Ride'],
  polyline: POLYLINE,
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 7,
  createdAt: '2026-01-15T10:00:00Z',
};

const STEP = MAP_CONTROL_SIZE + MAP_CONTROL_GAP;

function renderMap(props: Partial<React.ComponentProps<typeof SectionMapView>>) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SectionMapView section={SECTION} interactive headerBottom={HEADER_BOTTOM} {...props} />
    </SafeAreaProvider>
  );
}

function controlColumn() {
  const style = StyleSheet.flatten(screen.getByTestId('section-map-controls').props.style);
  const top = style.top as number;
  const maxHeight = style.maxHeight as number;
  const shown = screen.getByTestId('section-map-controls').props.children;
  const count = React.Children.toArray(shown).length;
  const perColumn = Math.floor((maxHeight + MAP_CONTROL_GAP) / STEP);
  return { style, top, maxHeight, count, perColumn };
}

describe('the section hero map control column', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('keeps every button inside a 294 dp hero with all five shown', async () => {
    await renderMap({ height: 294, enableFullscreen: true });
    const { style, top, maxHeight, count, perColumn } = controlColumn();

    expect(count).toBe(5);
    // Further columns wrap to the left, and the column is drawn as wide as all of them, since
    // layout sizes a wrapping column to its first and the rest would land past the map's edge.
    expect(style.flexWrap).toBe('wrap-reverse');
    const columns = Math.ceil(count / perColumn);
    expect(style.width).toBe(columns * STEP - MAP_CONTROL_GAP);
    expect(top + maxHeight).toBeLessThanOrEqual(294);
    // The buttons that fit one bounded column end inside the hero, and the rest wrap beside it.
    expect(top + perColumn * STEP - MAP_CONTROL_GAP).toBeLessThanOrEqual(294);
    expect(perColumn).toBeLessThan(count);
  });

  it('stays one column on a hero tall enough for every button', async () => {
    await renderMap({ height: 600, enableFullscreen: true });
    const { top, maxHeight, count, perColumn } = controlColumn();

    expect(perColumn).toBeGreaterThanOrEqual(count);
    expect(top + maxHeight).toBeLessThanOrEqual(600);
  });

  it('counts only the buttons it shows, so trimming frees the full-screen slot', async () => {
    await renderMap({ height: 294, enableFullscreen: true, trimRange: { start: 0, end: 2 } });
    expect(screen.queryByTestId('section-map-fullscreen')).toBeNull();
    const { top, maxHeight } = controlColumn();
    expect(top + maxHeight).toBeLessThanOrEqual(294);
  });
});
