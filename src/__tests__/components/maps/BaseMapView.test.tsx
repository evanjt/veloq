/**
 * Scenario: the shared map shell is rendered with the route and bounds inputs
 * every caller passes, including the degenerate ones.
 *
 * Expected behaviour: the shell mounts, exposes its control testIDs, and wires
 * the close and 3D callbacks. Assertions stay on testIDs and callbacks so they
 * remain valid if the underlying map library changes.
 */

import React from 'react';
import { render, fireEvent, screen, act, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BaseMapView, type BaseMapViewProps } from '@/features/maps/components/BaseMapView';

// The binding registers a TurboModule at import time. A hook on this screen's
// import path compares against one of its generated enums, so the stub is the
// module here.
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest
    .fn()
    .mockResolvedValue({ coords: { latitude: 46.948, longitude: 7.447 } }),
  Accuracy: { Balanced: 3 },
}));

// The real surface is rendered, wrapped so the test can read the sources it was
// handed and the camera moves sent through its ref.
const mockSurfaceProbe: {
  sources: Record<string, { data?: GeoJSON.FeatureCollection }>;
  initialCamera: unknown;
  setCamera: jest.Mock;
} = { sources: {}, initialCamera: null, setCamera: jest.fn() };

// The real 3D layer is rendered, wrapped so the test can read what it was
// handed and drive the callbacks its page would.
const mockMap3DProbe: { props: Record<string, unknown> | null } = { props: null };

jest.mock('@/features/maps/components/Map3DWebView', () => {
  const ReactLocal = require('react');
  const actual = jest.requireActual('@/features/maps/components/Map3DWebView');
  return {
    ...actual,
    Map3DWebView: ReactLocal.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<unknown>) => {
        mockMap3DProbe.props = props;
        return ReactLocal.createElement(actual.Map3DWebView, { ...props, ref });
      }
    ),
  };
});

jest.mock('@/features/maps/components/MapSurface', () => {
  const ReactLocal = require('react');
  const actual = jest.requireActual('@/features/maps/components/MapSurface');
  return {
    ...actual,
    MapSurface: ReactLocal.forwardRef(
      (
        props: { sources: (typeof mockSurfaceProbe)['sources']; initialCamera: unknown },
        ref: React.Ref<unknown>
      ) => {
        mockSurfaceProbe.sources = props.sources;
        // The surface builds its page from the camera it mounted with and
        // reads no later one, so that is the camera recorded.
        mockSurfaceProbe.initialCamera = ReactLocal.useRef(props.initialCamera).current;
        return ReactLocal.createElement(actual.MapSurface, {
          ...props,
          ref: (instance: { setCamera: (...args: unknown[]) => void } | null) => {
            const wrapped = instance && {
              ...instance,
              setCamera: (...args: unknown[]) => {
                mockSurfaceProbe.setCamera(...args);
                instance.setCamera(...args);
              },
            };
            if (typeof ref === 'function') ref(wrapped);
            else if (ref) (ref as React.MutableRefObject<unknown>).current = wrapped;
          },
        });
      }
    ),
  };
});

const mockSetCamera = jest.fn();
jest.mock('@/features/maps/lib/htmlBuilders/mapSurface', () => {
  const actual = jest.requireActual('@/features/maps/lib/htmlBuilders/mapSurface');
  return {
    ...actual,
    buildSetCameraScript: (...args: unknown[]) => {
      mockSetCamera(...args);
      return actual.buildSetCameraScript(...args);
    },
  };
});

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

const OVERLAY_SOURCES: NonNullable<BaseMapViewProps['overlaySources']> = {
  marks: {
    kind: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  },
};

const OVERLAY_LAYERS: NonNullable<BaseMapViewProps['overlayLayers']> = [
  { id: 'marks-line', type: 'line', source: 'marks', paint: { 'line-width': 2 } },
];

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

    const close = screen.getByRole('button', { name: 'maps.closeMap' });
    expect(close).toBe(screen.getByTestId('map-fullscreen-close'));
    fireEvent.press(close);
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

    pressMapAt([7.447, 46.948]);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress.mock.calls[0][0].coordinate).toEqual([7.447, 46.948]);
  });

  it('accepts overlay sources and layers alongside the route', () => {
    expect(() =>
      renderMap({
        routeCoordinates: ROUTE,
        overlaySources: OVERLAY_SOURCES,
        overlayLayers: OVERLAY_LAYERS,
      })
    ).not.toThrow();

    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
  });

  describe('in 3D', () => {
    const TRIM: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { kind: 'trimmed' },
          geometry: { type: 'LineString', coordinates: ROUTE.slice(0, 2) },
        },
      ],
    };
    const HIGHLIGHT: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { activityId: 'ride-a' },
          geometry: { type: 'LineString', coordinates: ROUTE },
        },
      ],
    };

    beforeEach(() => {
      mockMap3DProbe.props = null;
    });

    function enter3D() {
      fireEvent.press(screen.getByTestId('map-3d-toggle'));
      act(() => {
        (mockMap3DProbe.props!.onMapReady as () => void)();
      });
    }

    it('hands the terrain layer the overlays the caller drew in 2D', () => {
      renderMap({
        routeCoordinates: ROUTE,
        layer3D: { sectionTrimGeoJSON: TRIM, highlightedTraceGeoJSON: HIGHLIGHT },
      });

      enter3D();

      expect(mockMap3DProbe.props!.sectionTrimGeoJSON).toBe(TRIM);
      expect(mockMap3DProbe.props!.highlightedTraceGeoJSON).toBe(HIGHLIGHT);
    });

    it('sends a section marker tap on the terrain layer to the caller', () => {
      const onSectionClick = jest.fn();
      renderMap({ routeCoordinates: ROUTE, layer3D: { onSectionClick } });

      enter3D();
      act(() => {
        (mockMap3DProbe.props!.onSectionClick as (id: string) => void)('hill-climb');
      });

      expect(onSectionClick).toHaveBeenCalledWith('hill-climb');
    });

    it('brings the flat map back where the terrain camera was left', () => {
      renderMap({ routeCoordinates: ROUTE, bounds: BOUNDS });

      enter3D();
      expect(screen.queryByTestId('maplibre-map')).toBeNull();
      act(() => {
        (mockMap3DProbe.props!.onCameraStateChange as (c: unknown, g: boolean) => void)(
          { center: [7.6, 46.7], zoom: 14, bearing: 30, pitch: 60 },
          true
        );
      });
      fireEvent.press(screen.getByTestId('map-3d-toggle'));

      expect(screen.getByTestId('maplibre-map')).toBeTruthy();
      expect(mockSurfaceProbe.initialCamera).toEqual({ center: [7.6, 46.7], zoom: 14 });
    });

    it('fits the bounds again on a later visit when the terrain camera never moved', () => {
      renderMap({ routeCoordinates: ROUTE, bounds: BOUNDS });

      enter3D();
      fireEvent.press(screen.getByTestId('map-3d-toggle'));

      expect(mockSurfaceProbe.initialCamera).toEqual(
        expect.objectContaining({ bounds: { sw: BOUNDS.sw, ne: BOUNDS.ne } })
      );
    });
  });

  describe('the locate button', () => {
    const getPosition = Location.getCurrentPositionAsync as jest.Mock;

    beforeEach(() => {
      getPosition.mockClear();
      mockSurfaceProbe.setCamera.mockClear();
      mockSetCamera.mockClear();
    });

    async function pressLocate() {
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'maps.goToLocation' }));
      });
    }

    it('keeps the location source mounted and empty before any fix', () => {
      renderMap({ routeCoordinates: ROUTE });

      expect(mockSurfaceProbe.sources['user-location']?.data?.features).toEqual([]);
    });

    it('draws the dot at the fix and eases the camera to zoom 13', async () => {
      renderMap({ routeCoordinates: ROUTE });

      await pressLocate();

      expect(mockSurfaceProbe.setCamera).toHaveBeenCalledWith(
        { center: [7.447, 46.948], zoom: 13 },
        500
      );
      const [dot] = mockSurfaceProbe.sources['user-location'].data!.features;
      expect(dot.geometry).toEqual({ type: 'Point', coordinates: [7.447, 46.948] });
    });

    it('reuses a fix under thirty seconds old instead of asking the GPS again', async () => {
      renderMap({ routeCoordinates: ROUTE });

      await pressLocate();
      await pressLocate();

      expect(getPosition).toHaveBeenCalledTimes(1);
      expect(mockSurfaceProbe.setCamera).toHaveBeenCalledTimes(2);
    });

    it('shows a spinner and refuses presses while the fix is pending', async () => {
      let resolveFix: (fix: unknown) => void = () => {};
      getPosition.mockImplementationOnce(() => new Promise((resolve) => (resolveFix = resolve)));
      renderMap({ routeCoordinates: ROUTE });

      await pressLocate();

      const button = screen.getByRole('button', { name: 'maps.goToLocation' });
      expect(button.props.accessibilityState.disabled).toBe(true);
      expect(screen.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();

      await act(async () => {
        resolveFix({ coords: { latitude: 46.948, longitude: 7.447 } });
      });

      await waitFor(() => expect(screen.UNSAFE_queryByType(ActivityIndicator)).toBeNull());
      expect(
        screen.getByRole('button', { name: 'maps.goToLocation' }).props.accessibilityState.disabled
      ).toBe(false);
    });

    it('eases onto the fix at the shared locate zoom and reuses a fresh fix', async () => {
      renderMap({ routeCoordinates: ROUTE });
      const locate = screen.getByRole('button', { name: 'maps.goToLocation' });

      await act(async () => {
        fireEvent.press(locate);
      });
      await act(async () => {
        fireEvent.press(locate);
      });

      expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
      expect(mockSetCamera).toHaveBeenCalledTimes(2);
      expect(mockSetCamera).toHaveBeenLastCalledWith({ center: [7.447, 46.948], zoom: 13 }, 500);
    });
  });

  describe('degenerate input', () => {
    const cases: [string, Partial<BaseMapViewProps>][] = [
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
      ['empty overlays', { routeCoordinates: ROUTE, overlaySources: {}, overlayLayers: [] }],
    ];

    it.each(cases)('survives %s', (_label, props) => {
      expect(() => renderMap(props)).not.toThrow();
      expect(screen.getByTestId('maplibre-map')).toBeTruthy();
    });
  });
});

// The surface reports a tap as a bridge message, so a press test drives the
// same message the page would post rather than a renderer-specific event.
function pressMapAt(coordinate: [number, number]) {
  fireEvent(screen.getByTestId('maplibre-map'), 'message', {
    nativeEvent: {
      data: JSON.stringify({ type: 'mapClick', coordinate, point: [0, 0], feature: null }),
    },
  });
}
