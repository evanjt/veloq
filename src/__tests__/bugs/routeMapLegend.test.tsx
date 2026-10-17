/**
 * Scenario: the route detail map colours its line by time won and lost while
 * the chart shows the delta plot, and draws a picked attempt over it in its
 * own colour.
 *
 * Expected behaviour: a key names each of those layers while it is drawn,
 * inline and full screen, and the route alone draws no key.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initialiseI18n, changeLanguage } from '@/i18n';
import { RouteMapView } from '@/features/routes/components/RouteMapView';
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
  splits: [-2, 1, 3, -1],
  splitStepM: 1000,
  sectionLengthM: 4200,
  direction: 'forward' as const,
};

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

  it('names the time won and lost while the delta plot colours the line', async () => {
    await renderRoute({ deltaLine: DELTA_LINE });

    expect(screen.getByTestId('route-map-legend')).toBeTruthy();
    expect(screen.getByTestId('route-map-legend-delta')).toBeTruthy();
    expect(screen.getByText('Time won to time lost')).toBeTruthy();
    expect(screen.queryByText('This activity')).toBeNull();
  });

  it('names the picked attempt while one is drawn', async () => {
    await renderRoute({ highlightedActivityId: 'a1' });

    expect(screen.getByTestId('route-map-legend')).toBeTruthy();
    expect(screen.getByText('This activity')).toBeTruthy();
    expect(screen.queryByTestId('route-map-legend-delta')).toBeNull();
  });

  it('names the picked lap, which draws in the same colour', async () => {
    await renderRoute({ highlightedLapPoints: POINTS.slice(1, 3) });

    expect(screen.getByText('This activity')).toBeTruthy();
  });

  it('names both layers when both are drawn', async () => {
    await renderRoute({ deltaLine: DELTA_LINE, highlightedActivityId: 'a1' });

    expect(screen.getByTestId('route-map-legend-delta')).toBeTruthy();
    expect(screen.getByText('This activity')).toBeTruthy();
  });

  it('names the picked attempt full screen, where the line carries no delta colouring', async () => {
    await renderRoute({ deltaLine: DELTA_LINE, highlightedActivityId: 'a1' });

    await fireEvent.press(screen.getByTestId('route-map-container'));

    expect(screen.getAllByTestId('route-map-legend')).toHaveLength(2);
    expect(screen.getAllByTestId('route-map-legend-delta')).toHaveLength(1);
    expect(screen.getAllByText('This activity')).toHaveLength(2);
  });
});
