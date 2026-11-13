/**
 * Scenario: the activity detail map is rendered from either an encoded
 * polyline or a coordinate array, with optional section and route overlays.
 *
 * Expected behaviour: it mounts, exposes its control testIDs, opens fullscreen,
 * and tolerates a missing or malformed polyline rather than throwing.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityMapView } from '@/features/maps/components/ActivityMapView';
import type { LatLng } from '@/shared/geo/polyline';
import { streamsFromArrays } from '@/features/activity/lib/streams';
import { initialiseI18n } from '@/i18n';
import { DIVERGING_BANDS } from '@/features/maps/lib/divergingStep';
import { gradeStepTokenColour } from '@/features/maps/lib/gradientLineColor';
import { renderStaged } from '../../__shared__/stagedRender';
import { TERRAIN_3D_CONFIG } from '@/features/maps/components/mapStyles';
import type { SurfacePatch } from '@/features/maps/lib/mapSurfacePatch';

// The map page is hidden from screen readers, so a query reaching it includes hidden elements.
const MAP_PAGE = { includeHiddenElements: true };

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

/** Every patch the map page was sent, in order. */
const mockPatches: SurfacePatch[] = [];

jest.mock('@/features/maps/lib/mapSurfacePatch', () => {
  const actual = jest.requireActual('@/features/maps/lib/mapSurfacePatch');
  return {
    ...actual,
    createSurfacePatcher: () => {
      const patcher = actual.createSurfacePatcher();
      return {
        ...patcher,
        next: (specs: unknown) => {
          const result = patcher.next(specs);
          if (result.patch) mockPatches.push(result.patch);
          return result;
        },
      };
    },
  };
});

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'off',
  }),
}));

jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
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
  return renderStaged(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ActivityMapView activityType="Ride" coordinates={COORDINATES} showStyleToggle {...props} />
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  mockCached.clear();
});

describe('ActivityMapView', () => {
  vaultIt('mounts a map from a coordinate array', async () => {
    await renderActivityMap();

    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
    expect(screen.getByTestId('activity-map-style-toggle')).toBeTruthy();
  });

  vaultIt("sits the credit above the sheet covering the map's foot", async () => {
    await renderActivityMap({ coveredBottom: 240 });

    expect(StyleSheet.flatten(screen.getByTestId('map-attribution').props.style).bottom).toBe(240);
  });

  vaultIt(
    "stands the credit clear of the rounded corners of the sheet on the map's foot",
    async () => {
      await renderActivityMap({ coveredBottom: 240, coveredBottomRadius: 28 });

      const credit = StyleSheet.flatten(screen.getByTestId('map-attribution').props.style);
      expect(credit.bottom).toBe(240);
      expect(credit.left).toBe(28);
      expect(credit.right).toBe(28);
    }
  );

  vaultIt("keeps the credit on the map's foot when nothing covers it", async () => {
    await renderActivityMap();

    expect(StyleSheet.flatten(screen.getByTestId('map-attribution').props.style).bottom).toBe(0);
  });

  vaultIt('hides the control stack when the caller turns it off', async () => {
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

  vaultIt('unmounts the inline surface while fullscreen holds its own', async () => {
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

  vaultIt('renders section overlays for the sections tab', async () => {
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

  vaultIt('renders a route overlay alongside the activity trace', async () => {
    await renderActivityMap({ routeOverlay: COORDINATES });

    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
  });

  vaultIt('accepts a scrub highlight index', async () => {
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
    vaultIt('falls back to a placeholder with no geometry at all', async () => {
      await renderActivityMap({ coordinates: [] });

      expect(screen.queryByTestId('maplibre-map', MAP_PAGE)).toBeNull();
    });

    vaultIt('falls back to a placeholder with no coordinates at all', async () => {
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
    async function toggleGradient() {
      await fireEvent.press(screen.getByTestId('activity-map-layers'));
      await fireEvent.press(screen.getByTestId('activity-map-layer-gradient'));
    }
    const TICKS = ['-10', '-5', '-2', '+2', '+5', '+10', 'Downhill', 'Uphill', 'Grade (%)'];

    vaultIt('shows no gradient key while the line is in the sport colour', async () => {
      await renderActivityMap({ streams: GRADED });

      expect(screen.getByTestId('activity-map-layers')).toBeTruthy();
      expect(screen.queryByTestId('activity-map-key')).toBeNull();
    });

    vaultIt(
      'labels the scale with its gradient ticks while the line is coloured by gradient',
      async () => {
        await renderActivityMap({ streams: GRADED });

        await toggleGradient();

        const key = screen.getByTestId('activity-map-key');
        for (const tick of TICKS) {
          expect(within(key).getByText(tick)).toBeTruthy();
        }
        const steps = within(key).getAllByTestId('map-key-ramp-step');
        expect(steps.map((step) => StyleSheet.flatten(step.props.style).backgroundColor)).toEqual(
          DIVERGING_BANDS.grade.map((band) => gradeStepTokenColour(band.step, 'light'))
        );

        await toggleGradient();
        expect(screen.queryByTestId('activity-map-key')).toBeNull();
      }
    );

    it('keeps the key on the 3D map, which draws the gradient too', async () => {
      await renderActivityMap({
        streams: GRADED,
        initial3DCamera: { center: [7.448, 46.949], zoom: 13, bearing: 20, pitch: 60 },
      });

      await toggleGradient();

      expect(screen.queryByTestId('webview', MAP_PAGE)).toBeNull();
      expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
      expect(screen.getByTestId('activity-map-key')).toBeTruthy();
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
      await fireEvent(screen.getByTestId('maplibre-map', MAP_PAGE), 'message', {
        nativeEvent: { data: JSON.stringify(message) },
      });
    }

    function lastTerrain(): SurfacePatch['terrain'] {
      const withTerrain = mockPatches.filter((patch) => patch.terrain !== undefined);
      return withTerrain.at(-1)?.terrain;
    }

    function lastSource(id: string): { data: GeoJSON.FeatureCollection } | undefined {
      const withSource = mockPatches.filter((patch) => patch.sources?.[id]);
      return withSource.at(-1)?.sources?.[id] as { data: GeoJSON.FeatureCollection } | undefined;
    }

    function tapOnSection(sectionId: string) {
      const feature = {
        layerId: 'section-marker-circle',
        id: null,
        properties: { sectionId },
        geometry: null,
      };
      return post({
        type: 'mapClick',
        coordinate: [7.449, 46.95],
        point: [100, 100],
        feature,
        features: [feature],
      });
    }

    const SECTION = { id: 's1', sectionPolyline: COORDINATES, activityPortion: COORDINATES };

    beforeEach(() => {
      mockPatches.length = 0;
    });

    it('tilts the one surface over terrain, with no second page', async () => {
      await renderActivityMap({ initial3DCamera: CAMERA_3D });
      await post({ type: 'mapReady' });

      expect(screen.queryByTestId('webview', MAP_PAGE)).toBeNull();
      expect(screen.getAllByTestId('maplibre-map', MAP_PAGE)).toHaveLength(1);
      expect(lastTerrain()).toEqual({
        exaggeration: TERRAIN_3D_CONFIG.defaultExaggeration,
        pitch: CAMERA_3D.pitch,
        subjectSource: 'route',
        cameraPinned: false,
      });
    });

    it('pins a camera the athlete chose, so a ridge does not turn it', async () => {
      await renderActivityMap({ initial3DCamera: CAMERA_3D, initial3DCameraPinned: true });
      await post({ type: 'mapReady' });

      expect(lastTerrain()).toEqual(expect.objectContaining({ cameraPinned: true }));
    });

    it('tilts and flattens the same page on the toggle, sending no source again', async () => {
      await renderActivityMap();
      await post({ type: 'mapReady' });
      expect(lastTerrain()).toBeUndefined();
      const sentBefore = mockPatches.length;

      await fireEvent.press(screen.getByTestId('activity-map-3d-toggle'));
      expect(screen.queryByTestId('webview', MAP_PAGE)).toBeNull();
      expect(lastTerrain()).toEqual({
        exaggeration: TERRAIN_3D_CONFIG.defaultExaggeration,
        pitch: TERRAIN_3D_CONFIG.defaultPitch,
        subjectSource: 'route',
        cameraPinned: false,
      });
      expect(mockPatches.slice(sentBefore).some((patch) => patch.sources)).toBe(false);

      await fireEvent.press(screen.getByTestId('activity-map-3d-toggle'));
      expect(lastTerrain()).toBeNull();
    });

    vaultIt(
      'marks the 3D control busy, not the map, while the surface is still loading',
      async () => {
        await renderActivityMap({ initial3DCamera: CAMERA_3D });

        expect(screen.queryByTestId('activity-map-3d-loading')).toBeNull();
        expect(toggleState()).toEqual(expect.objectContaining({ busy: true, disabled: true }));
        expect(
          within(screen.getByTestId('activity-map-3d-toggle')).getByTestId('activity-map-3d-busy')
        ).toBeTruthy();
      }
    );

    it('ignores a press on the 3D control while the surface is still loading', async () => {
      const on3DModeChange = jest.fn();
      await renderActivityMap({ initial3DCamera: CAMERA_3D, on3DModeChange });

      await fireEvent.press(screen.getByTestId('activity-map-3d-toggle'));

      expect(on3DModeChange).not.toHaveBeenCalled();
    });

    it('frees the 3D control once the surface reports ready', async () => {
      await renderActivityMap({ initial3DCamera: CAMERA_3D });

      await post({ type: 'mapReady' });

      expect(toggleState()).toEqual(expect.objectContaining({ busy: false, disabled: false }));
      expect(screen.queryByTestId('activity-map-3d-busy')).toBeNull();
    });

    it('keeps the 2D layer mounted through a crashed page reloading', async () => {
      await renderActivityMap({ initial3DCamera: CAMERA_3D });
      await post({ type: 'mapReady' });

      await fireEvent(screen.getByTestId('maplibre-map', MAP_PAGE), 'renderProcessGone');

      expect(screen.getByTestId('activity-map-2d-layer')).toBeTruthy();
      expect(screen.getAllByTestId('maplibre-map', MAP_PAGE)).toHaveLength(1);
    });

    it('lies flat again when the page has no elevation tiles', async () => {
      await renderActivityMap({ initial3DCamera: CAMERA_3D });
      await post({ type: 'mapReady' });
      expect(lastTerrain()).toBeTruthy();

      await post({ type: 'terrainUnavailable', reason: 'no terrain tiles: 6 failed' });

      expect(lastTerrain()).toBeNull();
      expect(screen.getAllByTestId('maplibre-map', MAP_PAGE)).toHaveLength(1);
    });

    /**
     * The caller persists what it is told, ahead of every other preference and
     * with nothing to clear it, so a page that failed once turned 3D off for
     * that activity for ever on a device where nobody touched the toggle.
     */
    it('does not report a page with nothing to drape as a choice', async () => {
      const on3DModeChange = jest.fn();
      await renderActivityMap({ initial3DCamera: CAMERA_3D, on3DModeChange });
      await post({ type: 'mapReady' });

      await post({ type: 'terrainUnavailable', reason: 'no terrain tiles: 6 failed' });

      expect(on3DModeChange).not.toHaveBeenCalled();
    });

    it('does not report a surface that cannot draw as a choice, and frees the control', async () => {
      const on3DModeChange = jest.fn();
      await renderActivityMap({ initial3DCamera: CAMERA_3D, on3DModeChange });

      await post({ type: 'mapFailed', reason: 'load timeout' });

      expect(on3DModeChange).not.toHaveBeenCalled();
      expect(screen.queryByTestId('activity-map-3d-busy')).toBeNull();
    });

    it('does not report a WebView that could not load as a choice either', async () => {
      const on3DModeChange = jest.fn();
      await renderActivityMap({ initial3DCamera: CAMERA_3D, on3DModeChange });

      await fireEvent(screen.getByTestId('maplibre-map', MAP_PAGE), 'error', {
        nativeEvent: { description: 'net::ERR_NAME_NOT_RESOLVED' },
      });

      expect(on3DModeChange).not.toHaveBeenCalled();
      expect(screen.queryByTestId('activity-map-3d-busy')).toBeNull();
    });

    it('reports the toggle, which is the athlete choosing', async () => {
      const on3DModeChange = jest.fn();
      await renderActivityMap({ on3DModeChange });
      await post({ type: 'mapReady' });

      await fireEvent.press(screen.getByTestId('activity-map-3d-toggle'));
      expect(on3DModeChange).toHaveBeenLastCalledWith(true);

      await fireEvent.press(screen.getByTestId('activity-map-3d-toggle'));
      expect(on3DModeChange).toHaveBeenLastCalledWith(false);
    });

    it('reports a toggle that follows a missing elevation model, so a retry is a choice', async () => {
      const on3DModeChange = jest.fn();
      await renderActivityMap({ initial3DCamera: CAMERA_3D, on3DModeChange });
      await post({ type: 'mapReady' });

      await post({ type: 'terrainUnavailable', reason: 'no terrain tiles: 6 failed' });
      await fireEvent.press(screen.getByTestId('activity-map-3d-toggle'));

      expect(on3DModeChange).toHaveBeenCalledWith(true);
      expect(lastTerrain()).toBeTruthy();
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

      it('tilts the page once, without reporting it as a choice', async () => {
        const on3DModeChange = jest.fn();
        const view = await renderActivityMap({ on3DModeChange });
        await post({ type: 'mapReady' });
        expect(lastTerrain()).toBeUndefined();

        await rerenderWith(view, CAMERA_3D, on3DModeChange);

        expect(lastTerrain()).toBeTruthy();
        expect(on3DModeChange).not.toHaveBeenCalled();
      });

      it('stays flat when the athlete has already used the toggle', async () => {
        const view = await renderActivityMap();
        await post({ type: 'mapReady' });
        await fireEvent.press(screen.getByTestId('activity-map-3d-toggle'));
        await fireEvent.press(screen.getByTestId('activity-map-3d-toggle'));

        await rerenderWith(view, CAMERA_3D);

        expect(lastTerrain()).toBeNull();
      });

      it('stays flat after the page had nothing to drape', async () => {
        const view = await renderActivityMap({ initial3DCamera: CAMERA_3D });
        await post({ type: 'mapReady' });
        await post({ type: 'terrainUnavailable', reason: 'no terrain tiles: 6 failed' });

        await rerenderWith(view, { ...CAMERA_3D, bearing: 90 });

        expect(lastTerrain()).toBeNull();
      });
    });

    describe('taps', () => {
      it('open the section whose marker is under the finger, in 3D as in 2D', async () => {
        const onSectionMarkerPress = jest.fn();
        await renderActivityMap({
          initial3DCamera: CAMERA_3D,
          activeTab: 'sections',
          sectionOverlays: [SECTION],
          onSectionMarkerPress,
        });
        await post({ type: 'mapReady' });
        expect(lastTerrain()).toBeTruthy();

        await tapOnSection('s1');

        expect(onSectionMarkerPress).toHaveBeenCalledWith('s1');
      });

      it('place a section creation point in 3D', async () => {
        await renderActivityMap({ initial3DCamera: CAMERA_3D, creationMode: true });
        await post({ type: 'mapReady' });
        expect(lastSource('section-creation-markers')?.data.features).toHaveLength(0);

        await post({
          type: 'mapClick',
          coordinate: [COORDINATES[1]!.longitude, COORDINATES[1]!.latitude],
          point: [100, 100],
          feature: null,
          features: [],
        });

        expect(lastSource('section-creation-markers')?.data.features).toHaveLength(1);
      });
    });

    describe('with the feed poster cached', () => {
      const ACTIVITY_ID = 'ride-poster';

      beforeEach(() => {
        mockCached.add(`${ACTIVITY_ID}-light-true`);
      });

      it('boots the one page under the poster and drops the poster when it is ready', async () => {
        await renderActivityMap({ activityId: ACTIVITY_ID, initial3DCamera: CAMERA_3D });

        expect(screen.getByTestId('activity-map-poster')).toBeTruthy();
        expect(screen.getAllByTestId('maplibre-map', MAP_PAGE)).toHaveLength(1);
        expect(screen.queryByTestId('webview', MAP_PAGE)).toBeNull();

        await post({ type: 'mapReady' });

        expect(screen.queryByTestId('activity-map-poster')).toBeNull();
      });
    });

    vaultIt('tolerates unmounting while the page is still loading', async () => {
      const view = await renderActivityMap({ initial3DCamera: CAMERA_3D });

      expect(screen.getByTestId('activity-map-3d-busy')).toBeTruthy();
      await expect((async () => view.unmount())()).resolves.not.toThrow();
    });
  });
});
