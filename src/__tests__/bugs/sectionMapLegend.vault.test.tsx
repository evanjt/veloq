/**
 * Scenario: the section detail map names only the layers drawn over the
 * section's own line, which needs no label.
 *
 * Expected behaviour: nothing draws or is named for neighbouring sections, and
 * the legend appears only when the highlighted activity, a ledger version or
 * the delta colouring is on the map, or the chevrons naming the chart's direction. A picked attempt is keyed "This activity"
 * only when it is the activity the page was opened from, and otherwise by its
 * date, or as the selected attempt when no date is to hand.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initialiseI18n, changeLanguage } from '@/i18n';
import { SectionMapView } from '@/features/routes/components/SectionMapView';
import { DetailMapLegend } from '@/features/routes/components/DetailMapLegend';
import { buildDirectionLayer } from '@/features/maps';
import { mapPalette } from '@/theme';
import { formatFullDate } from '@/shared/format/format';
import type { FrequentSection, RoutePoint } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

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
    await initialiseI18n('en-AU');
  });

  beforeEach(async () => {
    await changeLanguage('en-AU');
  });

  it('draws no legend for the section alone', async () => {
    await renderMap();
    expect(screen.queryByTestId('section-map-legend')).toBeNull();
  });

  it('draws no nearby layer and no legend when neighbouring sections are passed', async () => {
    await renderMap({ nearbyPolylines: [nearby('a'), nearby('b')] } as never);

    expect(screen.queryByTestId('section-map-legend')).toBeNull();
    expect(screen.queryByText('Other sections nearby')).toBeNull();
    expect(screen.queryByText('This section')).toBeNull();
  });

  it('names only the highlighted lap when one is drawn', async () => {
    await renderMap({ highlightedLapPoints: POLYLINE });

    expect(screen.getByText('Selected attempt')).toBeTruthy();
    expect(screen.queryByText('This activity')).toBeNull();
    expect(screen.queryByText('This section')).toBeNull();
    expect(screen.queryByText('Other sections nearby')).toBeNull();
  });

  it('keys an earlier attempt picked on the chart by its date, not as this activity', async () => {
    const attemptDate = new Date(2023, 2, 12, 8, 30);
    await renderMap({
      pageActivityId: 'opened-from',
      highlightedActivityId: 'three-years-ago',
      highlightedActivityDate: attemptDate,
      highlightedLapPoints: POLYLINE,
    });

    expect(screen.getByText(formatFullDate(attemptDate))).toBeTruthy();
    expect(screen.queryByText('This activity')).toBeNull();
  });

  it('keys a picked attempt with no date as the selected attempt', async () => {
    await renderMap({
      pageActivityId: 'opened-from',
      highlightedActivityId: 'undated',
      highlightedLapPoints: POLYLINE,
    });

    expect(screen.getByText('Selected attempt')).toBeTruthy();
    expect(screen.queryByText('This activity')).toBeNull();
  });

  it('keys the attempt the page was opened from as this activity', async () => {
    await renderMap({
      pageActivityId: 'opened-from',
      highlightedActivityId: 'opened-from',
      highlightedActivityDate: new Date(2026, 5, 1),
      highlightedLapPoints: POLYLINE,
    });

    expect(screen.getByText('This activity')).toBeTruthy();
  });

  it('names the shown ledger version, which draws as a grey line', async () => {
    await renderMap({
      shadowTrack: [
        [7.447, 46.948],
        [7.449, 46.95],
      ],
    });

    expect(screen.getByText('Earlier version')).toBeTruthy();
    expect(screen.queryByText('This activity')).toBeNull();
  });

  it('keys the chevrons with the direction the chart is on', async () => {
    await renderMap({ shownDirection: 'reverse' });

    expect(screen.getByTestId('section-map-legend-direction')).toBeTruthy();
    expect(screen.getByText('Reverse')).toBeTruthy();
    expect(screen.queryByText('Forward')).toBeNull();
  });

  it.each(['light', 'dark', 'satellite'] as const)(
    'keys the chevrons in the colours the %s chevron layer paints',
    async (base) => {
      const palette = mapPalette(base);
      const paint = buildDirectionLayer({
        id: 'chevrons',
        source: 'line',
        palette,
        direction: 'forward',
      }).paint as Record<string, unknown>;
      await render(
        <DetailMapLegend
          isDark={palette.isDark}
          palette={palette}
          top={0}
          testID="key"
          showActivity={false}
          showDelta={false}
          direction="forward"
        />
      );

      const row = screen.getByTestId('key-direction');
      const [glyph] = row.findAllByType(MaterialCommunityIcons);
      const line = within(row).getByTestId('map-key-swatch').children[0] as ReactTestInstance;
      expect(glyph?.props.color).toBe(paint['icon-color']);
      expect(StyleSheet.flatten(line.props.style)).toMatchObject({
        backgroundColor: paint['icon-halo-color'],
      });
    }
  );

  it('keys no direction while the bounds are trimmed', async () => {
    await renderMap({ shownDirection: 'forward', trimRange: { start: 0, end: 2 } });

    expect(screen.queryByTestId('section-map-legend-direction')).toBeNull();
  });

  it('stays out of the preview form, which carries no controls', async () => {
    await renderMap({ interactive: false, highlightedLapPoints: POLYLINE });

    expect(screen.queryByTestId('section-map-legend')).toBeNull();
  });
});
