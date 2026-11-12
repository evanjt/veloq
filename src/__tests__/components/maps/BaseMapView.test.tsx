/**
 * Scenario: the shared map shell is rendered with the route and bounds inputs
 * every caller passes, including the degenerate ones.
 *
 * Expected behaviour: the shell mounts, exposes its control testIDs, and wires
 * the close and 3D callbacks. Assertions stay on testIDs and callbacks so they
 * remain valid if the underlying map library changes.
 */

import React from 'react';
import { render, fireEvent, screen, act, waitFor, within } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { ActivityIndicator, Animated, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BaseMapView, type BaseMapViewProps } from '@/features/maps/components/BaseMapView';
import { MapSurface, type MapCameraState } from '@/features/maps/components/MapSurface';
import { CompassArrow } from '@/shared/ui';
import { darkColors } from '@/theme';
import { TERRAIN_3D_CONFIG } from '@/features/maps/components/mapStyles';

// The map page is hidden from screen readers, so a query reaching it includes hidden elements.
const MAP_PAGE = { includeHiddenElements: true };

// The binding registers a TurboModule at import time. A hook on this screen's
// import path compares against one of its generated enums, so the stub is the
// module here.
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

const mockTheme = { isDark: false };
jest.mock('@/shared/app', () => ({
  useTheme: () => mockTheme,
}));

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  getForegroundPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ status: 'undetermined', canAskAgain: true }),
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
  layers: { id: string; paint?: Record<string, unknown> }[];
  interactiveLayers: string[] | undefined;
  terrain: unknown;
  mounts: number;
  initialCamera: unknown;
  setCamera: jest.Mock;
} = {
  sources: {},
  layers: [],
  interactiveLayers: undefined,
  terrain: null,
  mounts: 0,
  initialCamera: null,
  setCamera: jest.fn(),
};

// The terrain page is wrapped only to see whether anything mounts it.
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
        props: {
          sources: (typeof mockSurfaceProbe)['sources'];
          layers: (typeof mockSurfaceProbe)['layers'];
          interactiveLayers: string[] | undefined;
          terrain: unknown;
          initialCamera: unknown;
        },
        ref: React.Ref<unknown>
      ) => {
        mockSurfaceProbe.sources = props.sources;
        mockSurfaceProbe.layers = props.layers;
        mockSurfaceProbe.interactiveLayers = props.interactiveLayers;
        mockSurfaceProbe.terrain = props.terrain;
        ReactLocal.useEffect(() => {
          mockSurfaceProbe.mounts += 1;
        }, []);
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
const mockResetOrientation = jest.fn();
jest.mock('@/features/maps/lib/htmlBuilders/mapSurface', () => {
  const actual = jest.requireActual('@/features/maps/lib/htmlBuilders/mapSurface');
  return {
    ...actual,
    buildResetOrientationScript: (...args: unknown[]) => {
      mockResetOrientation(...args);
      return actual.buildResetOrientationScript(...args);
    },
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

const OVERLAY_LAYERS: NonNullable<BaseMapViewProps['overlayLayers']> = () => [
  { id: 'marks-line', type: 'line', source: 'marks', paint: { 'line-width': 2 } },
];

function readValue(value: Animated.Value): number {
  return (value as unknown as { __getValue: () => number }).__getValue();
}

function renderMap(props: Partial<BaseMapViewProps> = {}) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <BaseMapView {...props} />
    </SafeAreaProvider>
  );
}

describe('BaseMapView', () => {
  afterEach(() => {
    mockTheme.isDark = false;
  });

  describe('chrome over the map', () => {
    const groundOf = (testID: string) =>
      StyleSheet.flatten(screen.getByTestId(testID).props.style).backgroundColor;
    const attributionColour = () =>
      StyleSheet.flatten(screen.getByTestId('map-attribution-text').props.style).color;

    it('draws the dark chrome in a dark theme over the light map', async () => {
      mockTheme.isDark = true;
      await renderMap({ routeCoordinates: ROUTE, initialStyle: 'light' });

      expect(groundOf('map-style-toggle')).toBe(darkColors.surfaceRaised);
      expect(attributionColour()).toBe(darkColors.textSecondary);
    });

    it('draws the light chrome in a light theme over the satellite map', async () => {
      await renderMap({ routeCoordinates: ROUTE, initialStyle: 'satellite' });

      expect(groundOf('map-style-toggle')).not.toBe(darkColors.surfaceRaised);
      expect(attributionColour()).not.toBe(darkColors.textSecondary);
    });
  });

  it('draws the shared map credit once, held above the safe-area bottom inset', async () => {
    await renderMap({ routeCoordinates: ROUTE, initialStyle: 'light' });

    const credits = screen.getAllByTestId('map-attribution');
    expect(credits).toHaveLength(1);
    expect(within(credits[0]!).getByTestId('map-attribution-text')).toBeTruthy();
    expect(StyleSheet.flatten(credits[0]!.props.style).bottom).toBe(METRICS.insets.bottom);
  });

  it('rewrites the credit when the drawn base changes', async () => {
    await renderMap({ routeCoordinates: ROUTE, initialStyle: 'satellite' });
    const creditText = () => screen.getByTestId('map-attribution-text').props.children;
    const before = creditText();

    await fireEvent.press(screen.getByTestId('map-style-toggle'));

    expect(creditText()).not.toBe(before);
  });

  it('mounts a map with a route and bounds', async () => {
    await renderMap({ routeCoordinates: ROUTE, bounds: BOUNDS });

    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
  });

  it('shows the close control only when a close handler is supplied', async () => {
    const onClose = jest.fn();
    const { rerender } = await renderMap({ routeCoordinates: ROUTE });

    expect(screen.queryByTestId('map-fullscreen-close')).toBeNull();

    await rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <BaseMapView routeCoordinates={ROUTE} onClose={onClose} />
      </SafeAreaProvider>
    );

    const close = screen.getByRole('button', { name: 'maps.closeMap' });
    expect(close).toBe(screen.getByTestId('map-fullscreen-close'));
    await fireEvent.press(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the style toggle pressable', async () => {
    await renderMap({ routeCoordinates: ROUTE });

    const toggle = screen.getByTestId('map-style-toggle');
    await expect(
      (async () => {
        await fireEvent.press(toggle);
        await fireEvent.press(toggle);
        await fireEvent.press(toggle);
      })()
    ).resolves.not.toThrow();
    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
  });

  it('hides the toggles when the caller turns them off', async () => {
    await renderMap({ routeCoordinates: ROUTE, showStyleToggle: false, show3DToggle: false });

    expect(screen.queryByTestId('map-style-toggle')).toBeNull();
    expect(screen.queryByTestId('map-3d-toggle')).toBeNull();
  });

  it('offers 3D only when there is a route to drape', async () => {
    await renderMap({ routeCoordinates: [] });
    expect(screen.queryByTestId('map-3d-toggle')).toBeNull();

    await screen.unmount();

    await renderMap({ routeCoordinates: ROUTE });
    expect(screen.getByTestId('map-3d-toggle')).toBeTruthy();
  });

  it('resets the map to north and leaves the compass to the bearing the map reports', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    await renderMap({ routeCoordinates: ROUTE });
    const compass = screen.UNSAFE_getByType(CompassArrow).props.rotation as Animated.Value;
    const reportBearing = (bearing: number) =>
      act(() =>
        (
          screen.UNSAFE_getByType(MapSurface).props.onRegionIsChanging as (
            state: MapCameraState
          ) => void
        )({ bearing } as MapCameraState)
      );
    await reportBearing(30);
    mockResetOrientation.mockClear();

    await fireEvent.press(screen.getByRole('button', { name: 'maps.resetOrientation' }));

    expect(mockResetOrientation).toHaveBeenCalledTimes(1);
    expect(timing.mock.calls.filter(([value]) => value === compass)).toEqual([]);
    expect(readValue(compass)).toBe(-30);
    await reportBearing(0);
    expect(Math.abs(readValue(compass))).toBe(0);
    timing.mockRestore();
  });

  it('forwards map presses to the caller', async () => {
    const onPress = jest.fn();
    await renderMap({ routeCoordinates: ROUTE, onPress });

    await pressMapAt([7.447, 46.948]);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress.mock.calls[0][0].coordinate).toEqual([7.447, 46.948]);
  });

  it('accepts overlay sources and layers alongside the route', async () => {
    await expect(
      (async () =>
        renderMap({
          routeCoordinates: ROUTE,
          overlaySources: OVERLAY_SOURCES,
          overlayLayers: OVERLAY_LAYERS,
        }))()
    ).resolves.not.toThrow();

    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
  });

  describe('in 3D', () => {
    beforeEach(() => {
      mockMap3DProbe.props = null;
      mockSurfaceProbe.mounts = 0;
    });

    it('tilts the one surface over terrain and mounts no separate terrain page', async () => {
      await renderMap({ routeCoordinates: ROUTE });
      expect(mockSurfaceProbe.terrain).toBeNull();

      await fireEvent.press(screen.getByTestId('map-3d-toggle'));

      expect(mockSurfaceProbe.terrain).toEqual({
        exaggeration: TERRAIN_3D_CONFIG.defaultExaggeration,
        pitch: TERRAIN_3D_CONFIG.defaultPitch,
      });
      expect(mockMap3DProbe.props).toBeNull();
      expect(screen.getAllByTestId('maplibre-map', MAP_PAGE)).toHaveLength(1);

      await fireEvent.press(screen.getByTestId('map-3d-toggle'));
      expect(mockSurfaceProbe.terrain).toBeNull();
    });

    it('keeps the surface, its camera and the caller overlays through the toggle', async () => {
      await renderMap({
        routeCoordinates: ROUTE,
        bounds: BOUNDS,
        overlaySources: OVERLAY_SOURCES,
        overlayLayers: OVERLAY_LAYERS,
        interactiveLayers: ['marks-line'],
      });
      const camera = mockSurfaceProbe.initialCamera;

      await fireEvent.press(screen.getByTestId('map-3d-toggle'));

      expect(mockSurfaceProbe.mounts).toBe(1);
      expect(mockSurfaceProbe.initialCamera).toBe(camera);
      expect(mockSurfaceProbe.layers.map((layer) => layer.id)).toContain('marks-line');
      expect(mockSurfaceProbe.interactiveLayers).toEqual(['marks-line']);
      expect(mockSurfaceProbe.sources.marks).toBe(OVERLAY_SOURCES.marks);
    });

    it('hands the overlay builders whether the surface is over terrain', async () => {
      const overlayLayers = jest.fn(() => []);
      await renderMap({ routeCoordinates: ROUTE, overlayLayers });
      expect(overlayLayers).toHaveBeenLastCalledWith(expect.anything(), false);

      await fireEvent.press(screen.getByTestId('map-3d-toggle'));

      expect(overlayLayers).toHaveBeenLastCalledWith(expect.anything(), true);
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
        await fireEvent.press(screen.getByRole('button', { name: 'maps.goToLocation' }));
      });
    }

    it('keeps the location source mounted and empty before any fix', async () => {
      await renderMap({ routeCoordinates: ROUTE });

      expect(mockSurfaceProbe.sources['user-location']?.data?.features).toEqual([]);
    });

    it('draws the dot at the fix and eases the camera to zoom 13', async () => {
      await renderMap({ routeCoordinates: ROUTE });

      await pressLocate();

      expect(mockSurfaceProbe.setCamera).toHaveBeenCalledWith(
        { center: [7.447, 46.948], zoom: 13 },
        500
      );
      const [dot] = mockSurfaceProbe.sources['user-location'].data!.features;
      expect(dot.geometry).toEqual({ type: 'Point', coordinates: [7.447, 46.948] });
    });

    it('reuses a fix under thirty seconds old instead of asking the GPS again', async () => {
      await renderMap({ routeCoordinates: ROUTE });

      await pressLocate();
      await pressLocate();

      expect(getPosition).toHaveBeenCalledTimes(1);
      expect(mockSurfaceProbe.setCamera).toHaveBeenCalledTimes(2);
    });

    it('shows a spinner and refuses presses while the fix is pending', async () => {
      let resolveFix: (fix: unknown) => void = () => {};
      getPosition.mockImplementationOnce(() => new Promise((resolve) => (resolveFix = resolve)));
      await renderMap({ routeCoordinates: ROUTE });

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
      await renderMap({ routeCoordinates: ROUTE });
      const locate = screen.getByRole('button', { name: 'maps.goToLocation' });

      await act(async () => {
        await fireEvent.press(locate);
      });
      await act(async () => {
        await fireEvent.press(locate);
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
      ['empty overlays', { routeCoordinates: ROUTE, overlaySources: {}, overlayLayers: () => [] }],
    ];

    it.each(cases)('survives %s', async (_label, props) => {
      await expect((async () => renderMap(props))()).resolves.not.toThrow();
      expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
    });
  });
});

// The surface reports a tap as a bridge message, so a press test drives the
// same message the page would post rather than a renderer-specific event.
async function pressMapAt(coordinate: [number, number]) {
  await fireEvent(screen.getByTestId('maplibre-map', MAP_PAGE), 'message', {
    nativeEvent: {
      data: JSON.stringify({ type: 'mapClick', coordinate, point: [0, 0], feature: null }),
    },
  });
}
