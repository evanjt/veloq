/**
 * Scenario: the activity detail map is rendered from either an encoded
 * polyline or a coordinate array, with optional section and route overlays.
 *
 * Expected behaviour: it mounts, exposes its control testIDs, opens fullscreen,
 * and tolerates a missing or malformed polyline rather than throwing.
 */

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityMapView } from '@/features/maps/components/ActivityMapView';
import type { LatLng } from '@/shared/geo/polyline';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'off',
  }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const COORDINATES: LatLng[] = [
  { latitude: 46.948, longitude: 7.447 },
  { latitude: 46.949, longitude: 7.448 },
  { latitude: 46.95, longitude: 7.449 },
  { latitude: 46.951, longitude: 7.45 },
];

// A real encoded track through Bern, so the polyline path is exercised for
// real rather than through a hand-built coordinate array.
const ENCODED_POLYLINE = 'oewzHkvhc@_@_@_@_@_@_@';

function renderActivityMap(props: Partial<React.ComponentProps<typeof ActivityMapView>> = {}) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ActivityMapView activityType="Ride" coordinates={COORDINATES} showStyleToggle {...props} />
    </SafeAreaProvider>
  );
}

describe('ActivityMapView', () => {
  it('mounts a map from a coordinate array', () => {
    renderActivityMap();

    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
    expect(screen.getByTestId('activity-map-style-toggle')).toBeTruthy();
  });

  it('mounts a map from an encoded polyline', () => {
    renderActivityMap({ coordinates: undefined, polyline: ENCODED_POLYLINE });

    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
  });

  it('hides the control stack when the caller turns it off', () => {
    renderActivityMap({ showStyleToggle: false });

    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
    expect(screen.queryByTestId('activity-map-style-toggle')).toBeNull();
  });

  it('opens and closes fullscreen', () => {
    renderActivityMap({ enableFullscreen: true });

    expect(screen.queryByTestId('map-fullscreen-close')).toBeNull();

    fireEvent(screen.getByTestId('activity-map-fullscreen'), 'pressIn');
    expect(screen.getByTestId('map-fullscreen-close')).toBeTruthy();

    fireEvent.press(screen.getByTestId('map-fullscreen-close'));
    expect(screen.queryByTestId('map-fullscreen-close')).toBeNull();
  });

  it('reports style changes to the caller', () => {
    const onStyleChange = jest.fn();
    renderActivityMap({ onStyleChange });

    fireEvent(screen.getByTestId('activity-map-style-toggle'), 'pressIn');

    expect(onStyleChange).toHaveBeenCalled();
  });

  it('renders section overlays for the sections tab', () => {
    renderActivityMap({
      activeTab: 'sections',
      sectionOverlays: [
        {
          id: 's1',
          sectionPolyline: COORDINATES,
          activityPortion: COORDINATES.slice(0, 3),
          isPR: true,
        },
        { id: 's2', sectionPolyline: COORDINATES.slice(1) },
      ],
      highlightedSectionId: 's1',
    });

    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
  });

  it('renders a route overlay alongside the activity trace', () => {
    renderActivityMap({ routeOverlay: COORDINATES });

    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
  });

  it('accepts a scrub highlight index', () => {
    const { rerender } = renderActivityMap({ highlightIndex: 0 });

    expect(() =>
      rerender(
        <SafeAreaProvider initialMetrics={METRICS}>
          <ActivityMapView
            activityType="Ride"
            coordinates={COORDINATES}
            showStyleToggle
            highlightIndex={2}
          />
        </SafeAreaProvider>
      )
    ).not.toThrow();
    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
  });

  describe('degenerate input', () => {
    it('falls back to a placeholder with no geometry at all', () => {
      renderActivityMap({ coordinates: [] });

      expect(screen.queryByTestId('maplibre-map')).toBeNull();
    });

    it('tolerates a malformed polyline', () => {
      expect(() =>
        renderActivityMap({ coordinates: undefined, polyline: 'not-a-polyline!!!' })
      ).not.toThrow();
    });

    it('tolerates an empty polyline string', () => {
      renderActivityMap({ coordinates: undefined, polyline: '' });

      expect(screen.queryByTestId('maplibre-map')).toBeNull();
    });

    const cases: [string, Partial<React.ComponentProps<typeof ActivityMapView>>][] = [
      ['a single coordinate', { coordinates: [COORDINATES[0]] }],
      [
        'non-finite coordinates',
        {
          coordinates: [
            { latitude: NaN, longitude: 7.447 },
            { latitude: 46.949, longitude: Infinity },
            ...COORDINATES,
          ],
        },
      ],
      ['a highlight index past the end', { highlightIndex: 999 }],
      ['a negative highlight index', { highlightIndex: -1 }],
      ['an empty section overlay list', { activeTab: 'sections', sectionOverlays: [] }],
      [
        'a section overlay with an empty polyline',
        { activeTab: 'sections', sectionOverlays: [{ id: 's1', sectionPolyline: [] }] },
      ],
      ['a null route overlay', { routeOverlay: null }],
      ['an empty route overlay', { routeOverlay: [] }],
      ['no streams', { streams: null }],
    ];

    it.each(cases)('survives %s', (_label, props) => {
      expect(() => renderActivityMap(props)).not.toThrow();
      expect(screen.getByTestId('maplibre-map')).toBeTruthy();
    });
  });
  describe('3D terrain hero', () => {
    const CAMERA_3D = {
      center: [7.448, 46.949] as [number, number],
      zoom: 13,
      bearing: 20,
      pitch: 60,
    };

    function post(message: Record<string, unknown>) {
      fireEvent(screen.getByTestId('webview'), 'message', {
        nativeEvent: { data: JSON.stringify(message) },
      });
    }

    it('shows a spinner while the terrain page is still loading', () => {
      renderActivityMap({ initial3DCamera: CAMERA_3D });

      expect(screen.getByTestId('activity-map-3d-loading')).toBeTruthy();
      expect(screen.getByTestId('webview')).toBeTruthy();
    });

    it('clears the spinner once the terrain page reports ready', () => {
      renderActivityMap({ initial3DCamera: CAMERA_3D });

      post({ type: 'mapReady' });

      expect(screen.queryByTestId('activity-map-3d-loading')).toBeNull();
    });

    it('falls back to the 2D map when the terrain page reports failure', () => {
      const on3DModeChange = jest.fn();
      renderActivityMap({ initial3DCamera: CAMERA_3D, on3DModeChange });

      post({ type: 'mapFailed', reason: 'load timeout' });

      expect(screen.queryByTestId('activity-map-3d-loading')).toBeNull();
      expect(screen.queryByTestId('webview')).toBeNull();
      expect(screen.getByTestId('maplibre-map')).toBeTruthy();
      expect(on3DModeChange).toHaveBeenCalledWith(false);
    });

    it('falls back to the 2D map when the WebView itself fails to load', () => {
      renderActivityMap({ initial3DCamera: CAMERA_3D });

      fireEvent(screen.getByTestId('webview'), 'error', {
        nativeEvent: { description: 'net::ERR_NAME_NOT_RESOLVED' },
      });

      expect(screen.queryByTestId('activity-map-3d-loading')).toBeNull();
      expect(screen.getByTestId('maplibre-map')).toBeTruthy();
    });

    it('does not re-enter 3D after a failure', () => {
      renderActivityMap({ initial3DCamera: CAMERA_3D });

      post({ type: 'mapFailed', reason: 'load timeout' });
      fireEvent(screen.getByTestId('activity-map-3d-toggle'), 'pressIn');

      expect(screen.getByTestId('webview')).toBeTruthy();
      expect(screen.getByTestId('activity-map-3d-loading')).toBeTruthy();
    });

    it('reaches a terminal state again on a second mount', () => {
      const first = renderActivityMap({ initial3DCamera: CAMERA_3D });
      post({ type: 'mapFailed', reason: 'load timeout' });
      first.unmount();

      renderActivityMap({ initial3DCamera: CAMERA_3D });
      expect(screen.getByTestId('activity-map-3d-loading')).toBeTruthy();

      post({ type: 'mapFailed', reason: 'load timeout' });
      expect(screen.queryByTestId('activity-map-3d-loading')).toBeNull();
    });

    it('tolerates unmounting while the terrain page is still loading', () => {
      const view = renderActivityMap({ initial3DCamera: CAMERA_3D });

      expect(screen.getByTestId('activity-map-3d-loading')).toBeTruthy();
      expect(() => view.unmount()).not.toThrow();
    });
  });
});
