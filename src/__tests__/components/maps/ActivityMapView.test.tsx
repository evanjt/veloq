/**
 * Scenario: the activity detail map is rendered from either an encoded
 * polyline or a coordinate array, with optional section and route overlays.
 *
 * Expected behaviour: it mounts, exposes its control testIDs, opens fullscreen,
 * and tolerates a missing or malformed polyline rather than throwing.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityMapView } from '@/features/maps/components/ActivityMapView';
import type { LatLng } from '@/shared/geo/polyline';
import { streamsFromArrays } from '@/features/activity/lib/streams';
import { initialiseI18n } from '@/i18n';
import { GRADE_BANDS, gradeStepTokenColour } from '@/features/maps/lib/gradientLineColor';

// The map page is hidden from screen readers, so a query reaching it includes hidden elements.
const MAP_PAGE = { includeHiddenElements: true };

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'off',
  }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

const mockCached = new Set<string>();
jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  ...jest.requireActual('@/features/maps/lib/storage/terrainPreviewCache'),
  hasTerrainPreview: (id: string, style: string, is3D: boolean) =>
    mockCached.has(`${id}-${style}-${is3D}`),
  getTerrainPreviewUri: (id: string, style: string, is3D: boolean) =>
    `file:///previews/${id}-${style}-${is3D}.jpg`,
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

const COORDINATES: LatLng[] = [
  { latitude: 46.948, longitude: 7.447 },
  { latitude: 46.949, longitude: 7.448 },
  { latitude: 46.95, longitude: 7.449 },
  { latitude: 46.951, longitude: 7.45 },
];

// A real encoded track through Bern, so the polyline path is exercised for
// real rather than through a hand-built coordinate array.

function renderActivityMap(props: Partial<React.ComponentProps<typeof ActivityMapView>> = {}) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ActivityMapView activityType="Ride" coordinates={COORDINATES} showStyleToggle {...props} />
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  mockCached.clear();
});

describe('ActivityMapView', () => {
  it('mounts a map from a coordinate array', async () => {
    await renderActivityMap();

    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
    expect(screen.getByTestId('activity-map-style-toggle')).toBeTruthy();
  });

  it('hides the control stack when the caller turns it off', async () => {
    await renderActivityMap({ showStyleToggle: false });

    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
    expect(screen.queryByTestId('activity-map-style-toggle')).toBeNull();
  });

  it('opens and closes fullscreen', async () => {
    await renderActivityMap({ enableFullscreen: true });

    expect(screen.queryByTestId('map-fullscreen-close')).toBeNull();

    await fireEvent.press(screen.getByTestId('activity-map-fullscreen'));
    expect(screen.getByTestId('map-fullscreen-close')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('map-fullscreen-close'));
    expect(screen.queryByTestId('map-fullscreen-close')).toBeNull();
  });

  it('unmounts the inline surface while fullscreen holds its own', async () => {
    await renderActivityMap({ enableFullscreen: true });
    expect(screen.getAllByTestId('maplibre-map', MAP_PAGE)).toHaveLength(1);

    await fireEvent.press(screen.getByTestId('activity-map-fullscreen'));
    expect(screen.getAllByTestId('maplibre-map', MAP_PAGE)).toHaveLength(1);

    await fireEvent.press(screen.getByTestId('map-fullscreen-close'));
    expect(screen.getAllByTestId('maplibre-map', MAP_PAGE)).toHaveLength(1);
  });

  it('reports style changes to the caller', async () => {
    const onStyleChange = jest.fn();
    await renderActivityMap({ onStyleChange });

    await fireEvent.press(screen.getByTestId('activity-map-style-toggle'));

    expect(onStyleChange).toHaveBeenCalled();
  });

  it('renders section overlays for the sections tab', async () => {
    await renderActivityMap({
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

    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
  });

  it('renders a route overlay alongside the activity trace', async () => {
    await renderActivityMap({ routeOverlay: COORDINATES });

    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
  });

  it('accepts a scrub highlight index', async () => {
    const { rerender } = await renderActivityMap({ highlightIndex: 0 });

    await expect(
      (async () =>
        rerender(
          <SafeAreaProvider initialMetrics={METRICS}>
            <ActivityMapView
              activityType="Ride"
              coordinates={COORDINATES}
              showStyleToggle
              highlightIndex={2}
            />
          </SafeAreaProvider>
        ))()
    ).resolves.not.toThrow();
    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
  });

  describe('degenerate input', () => {
    it('falls back to a placeholder with no geometry at all', async () => {
      await renderActivityMap({ coordinates: [] });

      expect(screen.queryByTestId('maplibre-map', MAP_PAGE)).toBeNull();
    });

    it('falls back to a placeholder with no coordinates at all', async () => {
      await renderActivityMap({ coordinates: undefined });

      expect(screen.queryByTestId('maplibre-map', MAP_PAGE)).toBeNull();
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

    it.each(cases)('survives %s', async (_label, props) => {
      await expect((async () => renderActivityMap(props))()).resolves.not.toThrow();
      expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
    });
  });
  describe('colour by gradient', () => {
    beforeAll(async () => {
      await initialiseI18n('en-GB');
    });

    const GRADED = streamsFromArrays({
      grade_smooth: [-12, -3, 4, 14],
      distance: [0, 100, 200, 300],
    });
    const TICKS = ['-10%', '0%', '+10%'];

    it('shows no gradient key while the line is in the sport colour', async () => {
      await renderActivityMap({ streams: GRADED });

      expect(screen.getByTestId('activity-map-gradient-toggle')).toBeTruthy();
      expect(screen.queryByTestId('activity-map-gradient-key')).toBeNull();
    });

    it('labels the scale with its gradient ticks while the line is coloured by gradient', async () => {
      await renderActivityMap({ streams: GRADED });

      await fireEvent.press(screen.getByTestId('activity-map-gradient-toggle'));

      const key = screen.getByTestId('activity-map-gradient-key');
      for (const tick of TICKS) {
        expect(within(key).getByText(tick)).toBeTruthy();
      }
      const steps = within(key).getAllByTestId('map-key-ramp-step');
      expect(steps.map((step) => StyleSheet.flatten(step.props.style).backgroundColor)).toEqual(
        GRADE_BANDS.map((band) => gradeStepTokenColour(band.step, 'light'))
      );

      await fireEvent.press(screen.getByTestId('activity-map-gradient-toggle'));
      expect(screen.queryByTestId('activity-map-gradient-key')).toBeNull();
    });

    it('keeps the key on the 3D map, which draws the gradient too', async () => {
      await renderActivityMap({
        streams: GRADED,
        initial3DCamera: { center: [7.448, 46.949], zoom: 13, bearing: 20, pitch: 60 },
      });

      await fireEvent.press(screen.getByTestId('activity-map-gradient-toggle'));

      expect(screen.getByTestId('webview', MAP_PAGE)).toBeTruthy();
      expect(screen.getByTestId('activity-map-gradient-key')).toBeTruthy();
    });
  });

  describe('3D terrain hero', () => {
    const CAMERA_3D = {
      center: [7.448, 46.949] as [number, number],
      zoom: 13,
      bearing: 20,
      pitch: 60,
    };

    function toggleState() {
      return screen.getByTestId('activity-map-3d-toggle').props.accessibilityState;
    }

    async function post(message: Record<string, unknown>) {
      await fireEvent(screen.getByTestId('webview', MAP_PAGE), 'message', {
        nativeEvent: { data: JSON.stringify(message) },
      });
    }

    it('marks the 3D control busy, not the map, while the terrain page is still loading', async () => {
      await renderActivityMap({ initial3DCamera: CAMERA_3D });

      expect(screen.getByTestId('webview', MAP_PAGE)).toBeTruthy();
      expect(screen.queryByTestId('activity-map-3d-loading')).toBeNull();
      expect(toggleState()).toEqual(expect.objectContaining({ busy: true, disabled: true }));
      expect(
        within(screen.getByTestId('activity-map-3d-toggle')).getByTestId('activity-map-3d-busy')
      ).toBeTruthy();
    });

    it('ignores a press on the 3D control while the terrain page is still loading', async () => {
      const on3DModeChange = jest.fn();
      await renderActivityMap({ initial3DCamera: CAMERA_3D, on3DModeChange });

      await fireEvent.press(screen.getByTestId('activity-map-3d-toggle'));

      expect(screen.getByTestId('webview', MAP_PAGE)).toBeTruthy();
      expect(on3DModeChange).not.toHaveBeenCalledWith(false);
    });

    it('frees the 3D control once the terrain page reports ready', async () => {
      await renderActivityMap({ initial3DCamera: CAMERA_3D });

      await post({ type: 'mapReady' });

      expect(toggleState()).toEqual(expect.objectContaining({ busy: false, disabled: false }));
      expect(screen.queryByTestId('activity-map-3d-busy')).toBeNull();
    });

    it('restores the 2D surface while a crashed terrain page reloads', async () => {
      await renderActivityMap({ initial3DCamera: CAMERA_3D });
      await post({ type: 'mapReady' });
      expect(screen.queryByTestId('activity-map-2d-layer')).toBeNull();

      await fireEvent(screen.getByTestId('webview', MAP_PAGE), 'renderProcessGone');
      expect(screen.getByTestId('activity-map-2d-layer')).toBeTruthy();

      await post({ type: 'mapReady' });
      expect(screen.queryByTestId('activity-map-2d-layer')).toBeNull();

      await fireEvent(screen.getByTestId('webview', MAP_PAGE), 'renderProcessGone');
      expect(screen.getByTestId('activity-map-2d-layer')).toBeTruthy();
    });

    it('falls back to the 2D map when the terrain page reports failure', async () => {
      await renderActivityMap({ initial3DCamera: CAMERA_3D });

      await post({ type: 'mapFailed', reason: 'load timeout' });

      expect(screen.queryByTestId('activity-map-3d-busy')).toBeNull();
      expect(screen.queryByTestId('webview', MAP_PAGE)).toBeNull();
      expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
    });

    /**
     * The caller persists what it is told, ahead of every other preference and
     * with nothing to clear it, so a page that failed once turned 3D off for
     * that activity for ever on a device where nobody touched the toggle.
     */
    it('does not report a failure as the athlete turning 3D off', async () => {
      const on3DModeChange = jest.fn();
      await renderActivityMap({ initial3DCamera: CAMERA_3D, on3DModeChange });

      await post({ type: 'mapFailed', reason: 'load timeout' });

      expect(on3DModeChange).not.toHaveBeenCalled();
    });

    it('does not report a terrain page with nothing to drape as a choice either', async () => {
      const on3DModeChange = jest.fn();
      await renderActivityMap({ initial3DCamera: CAMERA_3D, on3DModeChange });
      await post({ type: 'mapReady' });

      await post({ type: 'terrainUnavailable', reason: 'no terrain tiles: 6 failed' });

      expect(on3DModeChange).not.toHaveBeenCalled();
    });

    it('does not report a WebView that could not load as a choice either', async () => {
      const on3DModeChange = jest.fn();
      await renderActivityMap({ initial3DCamera: CAMERA_3D, on3DModeChange });

      await fireEvent(screen.getByTestId('webview', MAP_PAGE), 'error', {
        nativeEvent: { description: 'net::ERR_NAME_NOT_RESOLVED' },
      });

      expect(on3DModeChange).not.toHaveBeenCalled();
    });

    it('reports the toggle, which is the athlete choosing', async () => {
      const on3DModeChange = jest.fn();
      await renderActivityMap({ on3DModeChange });

      await fireEvent.press(screen.getByTestId('activity-map-3d-toggle'));
      expect(on3DModeChange).toHaveBeenLastCalledWith(true);

      await post({ type: 'mapReady' });
      await fireEvent.press(screen.getByTestId('activity-map-3d-toggle'));
      expect(on3DModeChange).toHaveBeenLastCalledWith(false);
    });

    it('reports a toggle that follows a failure, so a retry is still a choice', async () => {
      const on3DModeChange = jest.fn();
      await renderActivityMap({ initial3DCamera: CAMERA_3D, on3DModeChange });

      await post({ type: 'mapFailed', reason: 'load timeout' });
      await fireEvent.press(screen.getByTestId('activity-map-3d-toggle'));

      expect(on3DModeChange).toHaveBeenCalledWith(true);
    });

    it('falls back to the 2D map when the WebView itself fails to load', async () => {
      await renderActivityMap({ initial3DCamera: CAMERA_3D });

      await fireEvent(screen.getByTestId('webview', MAP_PAGE), 'error', {
        nativeEvent: { description: 'net::ERR_NAME_NOT_RESOLVED' },
      });

      expect(screen.queryByTestId('activity-map-3d-busy')).toBeNull();
      expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
    });

    describe('a camera that arrives after mount', () => {
      async function rerenderWith(
        view: Awaited<ReturnType<typeof renderActivityMap>>,
        camera: typeof CAMERA_3D,
        on3DModeChange?: () => void
      ) {
        await view.rerender(
          <SafeAreaProvider initialMetrics={METRICS}>
            <ActivityMapView
              activityType="Ride"
              coordinates={COORDINATES}
              showStyleToggle
              initial3DCamera={camera}
              on3DModeChange={on3DModeChange}
            />
          </SafeAreaProvider>
        );
      }

      it('switches to 3D once, without reporting it as a choice', async () => {
        const on3DModeChange = jest.fn();
        const view = await renderActivityMap({ on3DModeChange });
        expect(screen.queryByTestId('webview', MAP_PAGE)).toBeNull();

        await rerenderWith(view, CAMERA_3D, on3DModeChange);

        expect(screen.getByTestId('webview', MAP_PAGE)).toBeTruthy();
        expect(on3DModeChange).not.toHaveBeenCalled();
      });

      it('stays flat when the athlete has already used the toggle', async () => {
        const view = await renderActivityMap();
        await fireEvent.press(screen.getByTestId('activity-map-3d-toggle'));
        await post({ type: 'mapReady' });
        await fireEvent.press(screen.getByTestId('activity-map-3d-toggle'));

        await rerenderWith(view, CAMERA_3D);

        expect(screen.queryByTestId('webview', MAP_PAGE)).toBeNull();
      });

      it('stays flat after a failure', async () => {
        const view = await renderActivityMap({ initial3DCamera: CAMERA_3D });
        await post({ type: 'mapFailed', reason: 'load timeout' });

        await rerenderWith(view, { ...CAMERA_3D, bearing: 90 });

        expect(screen.queryByTestId('webview', MAP_PAGE)).toBeNull();
      });
    });

    it('does not re-enter 3D after a failure', async () => {
      await renderActivityMap({ initial3DCamera: CAMERA_3D });

      await post({ type: 'mapFailed', reason: 'load timeout' });
      await fireEvent.press(screen.getByTestId('activity-map-3d-toggle'));

      expect(screen.getByTestId('webview', MAP_PAGE)).toBeTruthy();
      expect(screen.getByTestId('activity-map-3d-busy')).toBeTruthy();
    });

    it('reaches a terminal state again on a second mount', async () => {
      const first = await renderActivityMap({ initial3DCamera: CAMERA_3D });
      await post({ type: 'mapFailed', reason: 'load timeout' });
      await first.unmount();

      await renderActivityMap({ initial3DCamera: CAMERA_3D });
      expect(screen.getByTestId('activity-map-3d-busy')).toBeTruthy();

      await post({ type: 'mapFailed', reason: 'load timeout' });
      expect(screen.queryByTestId('activity-map-3d-busy')).toBeNull();
    });

    it('unmounts the 2D surface once the terrain page is ready', async () => {
      await renderActivityMap({ initial3DCamera: CAMERA_3D });
      expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();

      await post({ type: 'mapReady' });

      expect(screen.queryByTestId('maplibre-map', MAP_PAGE)).toBeNull();
      expect(screen.getAllByTestId('webview', MAP_PAGE)).toHaveLength(1);
    });

    it('brings the 2D surface back when the terrain page has nothing to drape', async () => {
      await renderActivityMap({ initial3DCamera: CAMERA_3D });
      await post({ type: 'mapReady' });

      await post({ type: 'terrainUnavailable', reason: 'no terrain tiles: 6 failed' });

      expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
      expect(screen.queryByTestId('webview', MAP_PAGE)).toBeNull();
    });

    describe('with the feed poster cached', () => {
      const ACTIVITY_ID = 'ride-poster';

      async function post2D(message: Record<string, unknown>) {
        await fireEvent(screen.getByTestId('maplibre-map', MAP_PAGE), 'message', {
          nativeEvent: { data: JSON.stringify(message) },
        });
      }

      beforeEach(() => {
        mockCached.add(`${ACTIVITY_ID}-light-true`);
      });

      it('builds only the terrain page while the poster covers the hero', async () => {
        await renderActivityMap({ activityId: ACTIVITY_ID, initial3DCamera: CAMERA_3D });

        expect(screen.getByTestId('activity-map-poster')).toBeTruthy();
        expect(screen.queryByTestId('activity-map-2d-layer')).toBeNull();
        expect(screen.getAllByTestId('webview', MAP_PAGE)).toHaveLength(1);

        await post({ type: 'mapReady' });

        expect(screen.queryByTestId('activity-map-poster')).toBeNull();
        expect(screen.queryByTestId('activity-map-2d-layer')).toBeNull();
      });

      it('mounts the 2D surface while a crashed terrain page reloads', async () => {
        await renderActivityMap({ activityId: ACTIVITY_ID, initial3DCamera: CAMERA_3D });
        await post({ type: 'mapReady' });

        await fireEvent(screen.getByTestId('webview', MAP_PAGE), 'renderProcessGone');

        expect(screen.getByTestId('activity-map-2d-layer')).toBeTruthy();
      });

      it('mounts the 2D surface when the terrain page fails before it is ready', async () => {
        await renderActivityMap({ activityId: ACTIVITY_ID, initial3DCamera: CAMERA_3D });

        await post({ type: 'mapFailed', reason: 'load timeout' });

        expect(screen.getByTestId('activity-map-2d-layer')).toBeTruthy();
        expect(screen.queryByTestId('webview', MAP_PAGE)).toBeNull();
      });

      it('keeps a 2D map already on screen while the toggled terrain page boots', async () => {
        await renderActivityMap({ activityId: ACTIVITY_ID });
        await post2D({ type: 'mapReady' });

        await fireEvent.press(screen.getByTestId('activity-map-3d-toggle'));

        expect(screen.getByTestId('activity-map-2d-layer')).toBeTruthy();
        expect(screen.getByTestId('webview', MAP_PAGE)).toBeTruthy();
      });
    });

    it('mounts the 2D surface under a booting terrain page with no poster to show', async () => {
      await renderActivityMap({ activityId: 'ride-uncached', initial3DCamera: CAMERA_3D });

      expect(screen.queryByTestId('activity-map-poster')).toBeNull();
      expect(screen.getByTestId('activity-map-2d-layer')).toBeTruthy();
    });

    it('tolerates unmounting while the terrain page is still loading', async () => {
      const view = await renderActivityMap({ initial3DCamera: CAMERA_3D });

      expect(screen.getByTestId('activity-map-3d-busy')).toBeTruthy();
      await expect((async () => view.unmount())()).resolves.not.toThrow();
    });
  });
});
