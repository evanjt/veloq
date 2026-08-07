/**
 * Scenario: the shared map shell is rendered with the route and bounds inputs
 * every caller passes, including the degenerate ones.
 *
 * Expected behaviour: the shell mounts, exposes its control testIDs, and wires
 * the close and 3D callbacks. Assertions stay on testIDs and callbacks so they
 * remain valid if the underlying map library changes.
 */

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest
    .fn()
    .mockResolvedValue({ coords: { latitude: 46.948, longitude: 7.447 } }),
  Accuracy: { Balanced: 3 },
}));

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BaseMapView, type BaseMapViewProps } from '@/features/maps/components/BaseMapView';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const ROUTE: [number, number][] = [
  [7.447, 46.948],
  [7.448, 46.949],
  [7.449, 46.95],
];

const BOUNDS = { ne: [7.449, 46.95] as [number, number], sw: [7.447, 46.948] as [number, number] };

function renderMap(props: Partial<BaseMapViewProps> = {}) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <BaseMapView {...props} />
    </SafeAreaProvider>
  );
}

describe('BaseMapView', () => {
  it('mounts a map with a route and bounds', () => {
    renderMap({ routeCoordinates: ROUTE, bounds: BOUNDS });

    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
    expect(screen.getByTestId('maplibre-camera')).toBeTruthy();
  });

  it('shows the close control only when a close handler is supplied', () => {
    const onClose = jest.fn();
    const { rerender } = renderMap({ routeCoordinates: ROUTE });

    expect(screen.queryByTestId('map-fullscreen-close')).toBeNull();

    rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <BaseMapView routeCoordinates={ROUTE} onClose={onClose} />
      </SafeAreaProvider>
    );

    fireEvent.press(screen.getByTestId('map-fullscreen-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the style toggle pressable', () => {
    renderMap({ routeCoordinates: ROUTE });

    const toggle = screen.getByTestId('map-style-toggle');
    expect(() => {
      fireEvent.press(toggle);
      fireEvent.press(toggle);
      fireEvent.press(toggle);
    }).not.toThrow();
    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
  });

  it('hides the toggles when the caller turns them off', () => {
    renderMap({ routeCoordinates: ROUTE, showStyleToggle: false, show3DToggle: false });

    expect(screen.queryByTestId('map-style-toggle')).toBeNull();
    expect(screen.queryByTestId('map-3d-toggle')).toBeNull();
  });

  it('offers 3D only when there is a route to drape', () => {
    renderMap({ routeCoordinates: [] });
    expect(screen.queryByTestId('map-3d-toggle')).toBeNull();

    screen.unmount();

    renderMap({ routeCoordinates: ROUTE });
    expect(screen.getByTestId('map-3d-toggle')).toBeTruthy();
  });

  it('swaps in the terrain view when 3D is enabled and back out again', () => {
    renderMap({ routeCoordinates: ROUTE });

    expect(screen.queryByTestId('webview')).toBeNull();

    fireEvent.press(screen.getByTestId('map-3d-toggle'));
    expect(screen.getByTestId('webview')).toBeTruthy();

    fireEvent.press(screen.getByTestId('map-3d-toggle'));
    expect(screen.queryByTestId('webview')).toBeNull();
  });

  it('forwards map presses to the caller', () => {
    const onPress = jest.fn();
    renderMap({ routeCoordinates: ROUTE, onPress });

    fireEvent(screen.getByTestId('maplibre-map'), 'press', {});
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders children alongside the route', () => {
    renderMap({
      routeCoordinates: ROUTE,
      children: <MarkerStub />,
    });

    expect(screen.getByTestId('base-map-child')).toBeTruthy();
  });

  describe('degenerate input', () => {
    const cases: Array<[string, Partial<BaseMapViewProps>]> = [
      ['no props at all', {}],
      ['an empty coordinate array', { routeCoordinates: [] }],
      ['a single coordinate', { routeCoordinates: [ROUTE[0]] }],
      [
        'non-finite coordinates',
        {
          routeCoordinates: [
            [NaN, 46.948],
            [7.448, Infinity],
          ],
        },
      ],
      ['missing bounds', { routeCoordinates: ROUTE, bounds: undefined }],
      ['collapsed bounds', { routeCoordinates: ROUTE, bounds: { ne: ROUTE[0], sw: ROUTE[0] } }],
      ['a null child', { routeCoordinates: ROUTE, children: null }],
    ];

    it.each(cases)('survives %s', (_label, props) => {
      expect(() => renderMap(props)).not.toThrow();
      expect(screen.getByTestId('maplibre-map')).toBeTruthy();
    });
  });
});

function MarkerStub() {
  const { View } = require('react-native');
  return <View testID="base-map-child" />;
}
