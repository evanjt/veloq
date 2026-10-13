/**
 * Scenario: the section detail hero map is rendered for sections whose
 * polyline, traces and trim range vary in quality.
 *
 * Expected behaviour: the interactive form exposes `section-map-container` and
 * its control testIDs, fullscreen opens and closes, and a section with no
 * usable geometry still mounts.
 */

import React from 'react';
import { Animated } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { render, fireEvent, screen, act, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SectionMapView } from '@/features/routes/components/SectionMapView';
import { MapSurface } from '@/features/maps/components/MapSurface';
import { CompassArrow } from '@/shared/ui';
import { TERRAIN_UNAVAILABLE_TEST_ID } from '@/features/maps/components/TerrainUnavailableNotice';
import type { FrequentSection, RoutePoint } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

const mockFitBounds = jest.fn();
const mockSetCamera = jest.fn();
const mockApply = jest.fn();
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
    buildApplyScript: (patch: unknown) => {
      mockApply(patch);
      return actual.buildApplyScript(patch);
    },
    buildFitBoundsScript: (...args: unknown[]) => {
      mockFitBounds(...args);
      return actual.buildFitBoundsScript(...args);
    },
  };
});

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
  getForegroundPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ status: 'undetermined', canAskAgain: true }),
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
  { lat: 46.951, lng: 7.45 },
  { lat: 46.952, lng: 7.451 },
];

function readValue(value: Animated.Value): number {
  return (value as unknown as { __getValue: () => number }).__getValue();
}

function section(overrides: Partial<FrequentSection> = {}): FrequentSection {
  return {
    id: 'section-1',
    sectionType: 'auto',
    name: 'Bern climb',
    sportTypes: ['Ride'],
    polyline: POLYLINE,
    distanceMeters: 1200,
    activityIds: ['a1', 'a2'],
    visitCount: 7,
    createdAt: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

function renderSection(props: Partial<React.ComponentProps<typeof SectionMapView>> = {}) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SectionMapView section={section()} interactive {...props} />
    </SafeAreaProvider>
  );
}

describe('SectionMapView', () => {
  it('mounts the interactive container with a map', async () => {
    await renderSection();

    expect(screen.getByTestId('section-map-container')).toBeTruthy();
    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
    expect(screen.getByTestId('section-map-style-toggle')).toBeTruthy();
    expect(screen.getByTestId('section-map-3d-toggle')).toBeTruthy();
  });

  it('drops the control stack in preview mode', async () => {
    await renderSection({ interactive: false });

    expect(screen.queryByTestId('section-map-container')).toBeNull();
    expect(screen.queryByTestId('section-map-style-toggle')).toBeNull();
    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
  });

  it('opens and closes fullscreen from the control stack', async () => {
    await renderSection({ enableFullscreen: true });

    expect(screen.queryByTestId('map-fullscreen-close')).toBeNull();

    await fireEvent(screen.getByTestId('section-map-fullscreen'), 'pressIn');
    expect(screen.queryByTestId('map-fullscreen-close')).toBeNull();

    await fireEvent.press(screen.getByTestId('section-map-fullscreen'));
    expect(screen.getByTestId('map-fullscreen-close')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('map-fullscreen-close'));
    expect(screen.queryByTestId('map-fullscreen-close')).toBeNull();
  });

  it('hides the fullscreen control while trimming', async () => {
    await renderSection({ enableFullscreen: true, trimRange: { start: 1, end: 3 } });

    expect(screen.queryByTestId('section-map-fullscreen')).toBeNull();
    expect(screen.getByTestId('section-map-container')).toBeTruthy();
  });

  it('swaps in the terrain view when 3D is enabled', async () => {
    await renderSection();

    expect(screen.queryByTestId('webview')).toBeNull();

    await fireEvent(screen.getByTestId('section-map-3d-toggle'), 'pressIn');
    expect(screen.queryByTestId('webview')).toBeNull();

    await fireEvent.press(screen.getByTestId('section-map-3d-toggle'));
    expect(screen.getByTestId('webview')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('section-map-3d-toggle'));
    expect(screen.queryByTestId('webview')).toBeNull();
  });

  it('changes style on release', async () => {
    await renderSection();

    const toggle = screen.getByTestId('section-map-style-toggle');
    const icon = toggle.findByType(MaterialCommunityIcons).props.name;
    await fireEvent(toggle, 'pressIn');
    expect(
      screen.getByTestId('section-map-style-toggle').findByType(MaterialCommunityIcons).props.name
    ).toBe(icon);

    await fireEvent.press(toggle);
    expect(
      screen.getByTestId('section-map-style-toggle').findByType(MaterialCommunityIcons).props.name
    ).not.toBe(icon);
  });

  it('resets orientation on release and leaves the compass to the bearing the map reports', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    await renderSection();
    const compass = screen.getByTestId('section-map-compass').findByType(CompassArrow).props
      .rotation as Animated.Value;
    const reportBearing = (bearing: number) =>
      act(() =>
        (screen.UNSAFE_getByType(MapSurface).props.onBearingChange as (b: number) => void)(bearing)
      );
    await reportBearing(-120);
    mockResetOrientation.mockClear();

    await fireEvent(screen.getByTestId('section-map-compass'), 'pressIn');
    expect(mockResetOrientation).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('section-map-compass'));
    expect(mockResetOrientation).toHaveBeenCalledTimes(1);
    expect(timing.mock.calls.filter(([value]) => value === compass)).toEqual([]);
    expect(readValue(compass)).toBe(120);
    await reportBearing(0);
    expect(Math.abs(readValue(compass))).toBe(0);
    timing.mockRestore();
  });

  it('renders pre-loaded traces for every activity', async () => {
    await renderSection({
      allActivityTraces: { a1: POLYLINE, a2: POLYLINE.slice(0, 3) },
      highlightedActivityId: 'a1',
    });

    expect(screen.getByTestId('section-map-container')).toBeTruthy();
  });

  describe('degenerate input', () => {
    it('falls back to a placeholder for an empty polyline', async () => {
      await renderSection({ section: section({ polyline: [] }) });

      expect(screen.queryByTestId('section-map-container')).toBeNull();
      expect(screen.queryByTestId('maplibre-map')).toBeNull();
    });

    const cases: [string, Partial<React.ComponentProps<typeof SectionMapView>>][] = [
      ['a single-point polyline', { section: section({ polyline: [POLYLINE[0]] }) }],
      [
        'non-finite polyline points',
        {
          section: section({
            polyline: [{ lat: NaN, lng: 7.447 }, { lat: 46.949, lng: Infinity }, ...POLYLINE],
          }),
        },
      ],
      ['an unknown sport type', { section: section({ sportTypes: ['Paragliding'] }) }],
      ['a trim range beyond the polyline', { trimRange: { start: 0, end: 99 } }],
      ['an inverted trim range', { trimRange: { start: 4, end: 1 } }],
      ['an empty extension track', { extensionTrack: [] }],
      ['empty activity traces', { allActivityTraces: {}, highlightedActivityId: 'a1' }],
      ['a highlighted activity with no trace', { highlightedActivityId: 'missing' }],
      ['an empty shadow track', { shadowTrack: [] }],
    ];

    it.each(cases)('survives %s', async (_label, props) => {
      await expect((async () => renderSection(props))()).resolves.not.toThrow();
      expect(screen.getByTestId('section-map-container')).toBeTruthy();
    });
  });
  describe('camera framing', () => {
    beforeEach(() => mockFitBounds.mockClear());

    it('leaves the camera alone when the same section arrives again', async () => {
      const { rerender } = await renderSection();
      const framed = mockFitBounds.mock.calls.length;
      expect(framed).toBeGreaterThan(0);

      // A `sections` engine event rebuilds the detail bundle, so `polyline` is a
      // fresh array of the same points. The athlete's own pan and zoom survive it.
      await rerender(
        <SafeAreaProvider initialMetrics={METRICS}>
          <SectionMapView
            section={section({ polyline: POLYLINE.map((p) => ({ ...p })) })}
            interactive
          />
        </SafeAreaProvider>
      );

      expect(mockFitBounds).toHaveBeenCalledTimes(framed);
    });

    it('reframes when the section itself changes', async () => {
      const { rerender } = await renderSection();
      const framed = mockFitBounds.mock.calls.length;

      await rerender(
        <SafeAreaProvider initialMetrics={METRICS}>
          <SectionMapView section={section({ id: 'section-2' })} interactive />
        </SafeAreaProvider>
      );

      expect(mockFitBounds.mock.calls.length).toBeGreaterThan(framed);
    });

    it('reframes on entering and leaving expand mode', async () => {
      const { rerender } = await renderSection();
      const framed = mockFitBounds.mock.calls.length;

      const withTrack = (track: RoutePoint[] | undefined) =>
        rerender(
          <SafeAreaProvider initialMetrics={METRICS}>
            <SectionMapView section={section()} interactive extensionTrack={track} />
          </SafeAreaProvider>
        );

      await withTrack(POLYLINE);
      const entered = mockFitBounds.mock.calls.length;
      expect(entered).toBeGreaterThan(framed);

      // Extending further inside expand mode is the athlete moving the handle,
      // not a mode change, so it does not snatch the viewport back.
      await withTrack([...POLYLINE, { lat: 46.953, lng: 7.452 }]);
      expect(mockFitBounds.mock.calls.length).toBe(entered);

      await withTrack(undefined);
      expect(mockFitBounds.mock.calls.length).toBeGreaterThan(entered);
    });
  });

  it('falls back to the 2D map when the terrain page reports failure', async () => {
    await renderSection();

    await fireEvent.press(screen.getByTestId('section-map-3d-toggle'));
    expect(screen.getByTestId('section-map-3d-loading')).toBeTruthy();

    await fireEvent(screen.getByTestId('webview'), 'message', {
      nativeEvent: { data: JSON.stringify({ type: 'mapFailed', reason: 'ready timeout' }) },
    });

    expect(screen.queryByTestId('section-map-3d-loading')).toBeNull();
    expect(screen.queryByTestId('webview')).toBeNull();
    expect(screen.getByTestId('section-map-container')).toBeTruthy();
  });

  it('falls back to the 2D map and says why when the terrain page has no elevation tiles', async () => {
    await renderSection();

    await fireEvent.press(screen.getByTestId('section-map-3d-toggle'));
    expect(screen.queryByTestId(TERRAIN_UNAVAILABLE_TEST_ID)).toBeNull();

    await fireEvent(screen.getByTestId('webview'), 'message', {
      nativeEvent: {
        data: JSON.stringify({ type: 'terrainUnavailable', reason: 'no terrain tiles: 6 failed' }),
      },
    });

    expect(screen.queryByTestId('webview')).toBeNull();
    expect(screen.queryByTestId('section-map-3d-loading')).toBeNull();
    expect(screen.getByTestId('section-map-3d-toggle').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false })
    );
    expect(screen.getByTestId(TERRAIN_UNAVAILABLE_TEST_ID)).toBeTruthy();
  });

  describe('locate button', () => {
    const requestPermission = Location.requestForegroundPermissionsAsync as jest.Mock;
    const getPosition = Location.getCurrentPositionAsync as jest.Mock;

    beforeEach(() => {
      mockSetCamera.mockClear();
      mockApply.mockClear();
      requestPermission.mockReset().mockResolvedValue({ status: 'granted' });
      getPosition.mockReset().mockResolvedValue({ coords: { longitude: 7.5, latitude: 46.5 } });
    });

    async function markSurfaceReady() {
      await act(async () => {
        await fireEvent(screen.getByTestId('maplibre-map'), 'message', {
          nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) },
        });
      });
    }

    function sourcesSent(): Record<string, { data: GeoJSON.FeatureCollection }> {
      return Object.assign({}, ...mockApply.mock.calls.map(([patch]) => patch.sources ?? {}));
    }

    it('is found by its label and is not pressable while a fix is awaited', async () => {
      await renderSection();
      expect(screen.getByLabelText('maps.goToLocation')).toBeTruthy();

      await fireEvent.press(screen.getByLabelText('maps.goToLocation'));
      expect(screen.getByLabelText('maps.goToLocation').props.accessibilityState.disabled).toBe(
        true
      );
      await waitFor(() => expect(mockSetCamera).toHaveBeenCalled());
    });

    it('reuses a recent fix, lands at the shared zoom and draws the dot', async () => {
      await renderSection();
      await markSurfaceReady();
      expect(sourcesSent()['user-location'].data.features).toEqual([]);

      await fireEvent.press(screen.getByLabelText('maps.goToLocation'));
      await waitFor(() => expect(mockSetCamera).toHaveBeenCalledTimes(1));
      await fireEvent.press(screen.getByLabelText('maps.goToLocation'));
      await waitFor(() => expect(mockSetCamera).toHaveBeenCalledTimes(2));

      expect(getPosition).toHaveBeenCalledTimes(1);
      expect(mockSetCamera).toHaveBeenLastCalledWith({ center: [7.5, 46.5], zoom: 13 }, 500);
      const dot = mockApply.mock.calls
        .map(([patch]) => patch.sources?.['user-location']?.data)
        .filter(Boolean)
        .pop();
      expect(dot.features[0].geometry).toEqual({ type: 'Point', coordinates: [7.5, 46.5] });
    });

    it('leaves the map and the dot alone when permission is refused', async () => {
      requestPermission.mockResolvedValue({ status: 'denied' });
      await renderSection();
      await markSurfaceReady();

      await fireEvent.press(screen.getByLabelText('maps.goToLocation'));
      await waitFor(() =>
        expect(screen.getByLabelText('maps.goToLocation').props.accessibilityState.disabled).toBe(
          false
        )
      );

      expect(mockSetCamera).not.toHaveBeenCalled();
      expect(sourcesSent()['user-location'].data.features).toEqual([]);
    });

    it('eases onto the fix at the shared locate zoom and reuses a fresh fix', async () => {
      getPosition.mockResolvedValue({ coords: { latitude: 46.948, longitude: 7.447 } });
      await renderSection();
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
});
