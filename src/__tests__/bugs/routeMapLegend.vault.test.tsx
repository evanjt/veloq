/**
 * Scenario: the route detail map bands its line by how far ahead or behind
 * the shown attempt is while the chart shows the delta plot, and draws a
 * picked attempt over it in its own colour.
 *
 * Expected behaviour: a key names each of those layers while it is drawn,
 * inline and full screen, and the route alone draws no key. The picked attempt
 * is "This activity" only when the page was opened from it, and otherwise is
 * named by its date.
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initialiseI18n, changeLanguage } from '@/i18n';
import { RouteMapView } from '@/features/routes/components/RouteMapView';
import { DetailMapLegend } from '@/features/routes/components/DetailMapLegend';
import { DIVERGING_BANDS } from '@/features/maps/lib/divergingStep';
import { mapPalette } from '@/theme';
import { formatFullDate } from '@/shared/format/format';
import type { RoutePoint } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getStyleForActivity: () => 'light',
  }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
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

const ROUTE_GROUP = {
  id: 'route-1',
  name: 'Harbour loop',
  signature: { points: POINTS, distance: 4200 },
  activityIds: ['a1', 'a2'],
  activityCount: 2,
  type: 'Ride' as const,
};

const DELTA_LINE = {
  percents: [-2, 1, 3, -1],
  splitStepM: 1000,
  sectionLengthM: 4200,
  direction: 'forward' as const,
};

const PICKED_DATE = new Date(2023, 2, 12, 8, 30);

function renderRoute(props: Partial<React.ComponentProps<typeof RouteMapView>> = {}) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <RouteMapView
        routeGroup={ROUTE_GROUP}
        enableFullscreen
        activitySignatures={{ a1: { points: POINTS }, a2: { points: POINTS.slice(0, 3) } }}
        {...props}
      />
    </SafeAreaProvider>
  );
}

describe('the route detail map key', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  beforeEach(async () => {
    await changeLanguage('en-AU');
  });

  it('draws no key for the route alone', async () => {
    await renderRoute();

    expect(screen.queryByTestId('route-map-legend')).toBeNull();
  });

  it('draws the steps the line is banded in as one ticked scale while the delta plot is shown', async () => {
    await renderRoute({ deltaLine: DELTA_LINE });

    expect(screen.getByTestId('route-map-legend')).toBeTruthy();
    expect(screen.getByTestId('route-map-legend-delta')).toBeTruthy();
    expect(screen.getByText('Ahead or behind (%)')).toBeTruthy();
    const scale = screen.getByTestId('route-map-legend-delta-scale');
    expect(within(scale).getAllByTestId('map-key-ramp-step')).toHaveLength(7);
    expect(within(scale).getByText('Faster')).toBeTruthy();
    expect(within(scale).getByText('Slower')).toBeTruthy();
    expect(screen.queryByTestId('route-map-legend-delta-no-data')).toBeNull();
    expect(screen.queryByText('This activity')).toBeNull();
  });

  it('names the stretches with no data when the attempt has some', async () => {
    await renderRoute({ deltaLine: { ...DELTA_LINE, percents: [-2, NaN, 3, -1] } });

    expect(screen.getByTestId('route-map-legend-delta-no-data')).toBeTruthy();
    expect(screen.getByText('No data')).toBeTruthy();
  });

  it('names an attempt picked on the chart by its date while it is drawn', async () => {
    await renderRoute({
      highlightedActivityId: 'a2',
      highlightedActivityDate: PICKED_DATE,
      pageActivityId: 'a1',
    });

    expect(screen.getByTestId('route-map-legend')).toBeTruthy();
    expect(screen.getByText(formatFullDate(PICKED_DATE))).toBeTruthy();
    expect(screen.queryByText('This activity')).toBeNull();
    expect(screen.queryByTestId('route-map-legend-delta')).toBeNull();
  });

  it('names the picked attempt this activity when the page was opened from it', async () => {
    await renderRoute({
      highlightedActivityId: 'a1',
      highlightedActivityDate: PICKED_DATE,
      pageActivityId: 'a1',
    });

    expect(screen.getByText('This activity')).toBeTruthy();
  });

  it('names a picked lap with no date the selected attempt, in the same colour', async () => {
    await renderRoute({ highlightedLapPoints: POINTS.slice(1, 3) });

    expect(screen.getByText('Selected attempt')).toBeTruthy();
    expect(screen.queryByText('This activity')).toBeNull();
  });

  it('names both layers when both are drawn', async () => {
    await renderRoute({
      deltaLine: DELTA_LINE,
      highlightedActivityId: 'a1',
      pageActivityId: 'a1',
    });

    expect(screen.getByTestId('route-map-legend-delta')).toBeTruthy();
    expect(screen.getByText('This activity')).toBeTruthy();
  });

  it('names the picked attempt and the bands full screen, which draws the ramp too', async () => {
    await renderRoute({
      deltaLine: DELTA_LINE,
      highlightedActivityId: 'a2',
      highlightedActivityDate: PICKED_DATE,
      pageActivityId: 'a1',
    });

    await fireEvent.press(screen.getByTestId('route-map-container'));

    expect(screen.getAllByTestId('route-map-legend')).toHaveLength(2);
    expect(screen.getAllByTestId('route-map-legend-delta')).toHaveLength(2);
    expect(screen.getAllByText(formatFullDate(PICKED_DATE))).toHaveLength(2);
    expect(screen.queryByText('This activity')).toBeNull();
  });
});

describe('the ahead-or-behind key', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('draws the seven bands as one scale ticked at their edges, not a row per band', async () => {
    const palette = mapPalette('light');
    await render(
      <DetailMapLegend
        isDark={false}
        palette={palette}
        top={0}
        testID="legend"
        showActivity={false}
        showDelta
        showDeltaGaps
      />
    );

    const scale = screen.getByTestId('legend-delta-scale');
    const steps = within(scale).getAllByTestId('map-key-ramp-step');
    expect(steps.map((step) => StyleSheet.flatten(step.props.style).backgroundColor)).toEqual(
      DIVERGING_BANDS.pace.map((band) => palette.div[band.step])
    );
    expect(within(scale).getAllByText('6')).toHaveLength(2);
    expect(within(scale).getAllByText('3')).toHaveLength(2);
    expect(within(scale).getAllByText('1')).toHaveLength(2);
    expect(within(scale).getByText('Faster')).toBeTruthy();
    expect(within(scale).getByText('Slower')).toBeTruthy();
    expect(screen.getByText('Ahead or behind (%)')).toBeTruthy();
    expect(screen.getAllByText('No data')).toHaveLength(1);
    expect(screen.getByTestId('legend-delta-no-data')).toBeTruthy();
    expect(screen.queryByTestId('legend-delta-cool-3')).toBeNull();
    expect(screen.queryAllByTestId('map-key-swatch')).toHaveLength(1);
    expect(screen.queryByText('Band edges blend over a short stretch')).toBeNull();
  });
});
