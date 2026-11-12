import React, { useState, useCallback, useRef, useMemo, ReactNode, useEffect } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { useTheme } from '@/shared/app';
// Straight from the context, not the app barrel: a surface mounted with no
// app shell still has to draw, and the barrel is what such a caller stubs.
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { darkColors, layers, mapPalette, spacing } from '@/theme';
import { AttributionOverlay, type AttributionOverlayRef } from './AttributionOverlay';
import { MapSurface, type MapPressEvent, type MapSurfaceRef } from './MapSurface';
import { MAP_CONTROL_GAP, MAP_CONTROL_SIZE, MapControlButton } from './MapControlButton';
import {
  featureCollection,
  lineFeature,
  lngLatFromTuples,
  type LngLat,
  type LngLatBounds,
} from '@/features/maps/lib/coordinates';
import type {
  MapImageSpec,
  MapLayerSpec,
  MapSourceSpec,
  MapTerrainSpec,
} from '@/features/maps/lib/htmlBuilders';
import { type MapStyleType, TERRAIN_3D_CONFIG, getStyleIcon } from './mapStyles';
import {
  composeBaseMapLayers,
  type MapGradientForBase,
  type MapLayersForBase,
} from '@/features/maps/lib/baseMapLayers';
import { computeAttribution } from '@/features/maps/lib/computeAttribution';
import { useMapStyleToggle } from '@/features/maps/hooks/useDrawnMapStyle';
import { useLocateUser } from '@/features/maps/hooks/useLocateUser';
import { useTerrainFallback } from '@/features/maps/hooks/useTerrainFallback';
import { useSharedTerrain3D } from '@/features/maps/hooks/useHostTerrain3D';
import {
  USER_LOCATION_SOURCE_ID,
  buildUserLocationCollection,
  buildUserLocationLayers,
} from '@/features/maps/lib/userLocationLayer';
import { LOCATE_GLYPH } from '@/features/maps/lib/mapGlyphs';

/** Room left around fitted bounds, in pixels. Extra on top for the controls. */
const DEFAULT_FIT_PADDING = { top: 80, right: 40, bottom: 40, left: 40 } as const;

export interface BaseMapViewProps {
  /** Route coordinates as [lng, lat] pairs for GeoJSON */
  routeCoordinates?: LngLat[] | undefined;
  /** Route line colour, the base's route colour when left out. */
  routeColor?: string | undefined;
  /** The route is context under a selection, drawn in the base's muted colour. */
  routeContext?: boolean | undefined;
  /**
   * The route line's ramp along its length, built for the base this map draws,
   * as the inline map draws it. It takes the place of the route colour.
   */
  routeGradient?: MapGradientForBase | undefined;
  /** Bounds to fit camera to */
  bounds?: { ne: LngLat; sw: LngLat } | undefined;
  /** Camera padding in pixels */
  padding?: { top: number; right: number; bottom: number; left: number } | undefined;
  /** Initial map style */
  initialStyle?: MapStyleType | undefined;
  /** Show style toggle button */
  showStyleToggle?: boolean | undefined;
  /** Show 3D toggle button */
  show3DToggle?: boolean | undefined;
  /** Show orientation/compass button */
  showOrientationButton?: boolean | undefined;
  /** Show location button */
  showLocationButton?: boolean | undefined;
  /** Show attribution */
  showAttribution?: boolean | undefined;
  /** Called when map is pressed */
  onPress?: ((event: MapPressEvent) => void) | undefined;
  /**
   * Extra sources the caller wants drawn over the route, keyed by id. Declared
   * as data rather than passed as JSX so the same description works whichever
   * renderer is behind the surface.
   */
  overlaySources?: Record<string, MapSourceSpec> | undefined;
  /**
   * Extra layers over the route, in draw order, built for the palette of the
   * base this map draws, which the athlete can change here.
   */
  overlayLayers?: MapLayersForBase | undefined;
  /** Extra layers beneath the route line, in draw order; they read the overlay sources. */
  underRouteLayers?: MapLayersForBase | undefined;
  /** Images the overlay layers reference by id. */
  overlayImages?: MapImageSpec[] | undefined;
  /** Overlay layers that respond to a tap, most specific first. */
  interactiveLayers?: string[] | undefined;
  /** Custom control buttons to add to the control stack */
  extraControls?: ReactNode | undefined;
  /** Close button handler (for fullscreen maps) */
  onClose?: (() => void) | undefined;
}

const NO_SOURCES: Record<string, MapSourceSpec> = {};
const NO_LAYERS: MapLayersForBase = () => [];

export function BaseMapView({
  routeCoordinates,
  routeColor,
  routeContext = false,
  routeGradient,
  bounds,
  padding = DEFAULT_FIT_PADDING,
  initialStyle,
  showStyleToggle = true,
  show3DToggle = true,
  showOrientationButton = true,
  showLocationButton = true,
  showAttribution = true,
  onPress,
  overlaySources = NO_SOURCES,
  overlayLayers = NO_LAYERS,
  underRouteLayers = NO_LAYERS,
  overlayImages,
  interactiveLayers,
  extraControls,
  onClose,
}: BaseMapViewProps) {
  const { t } = useTranslation();
  // Chrome over the map follows the app theme, whatever base is drawn under it.
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const systemStyle: MapStyleType = isDark ? 'dark' : 'light';

  const [chosenStyle, setChosenStyle] = useState<MapStyleType>(initialStyle ?? systemStyle);
  const {
    drawn: mapStyle,
    next: nextStyle,
    cycle: toggleStyle,
  } = useMapStyleToggle(chosenStyle, setChosenStyle);
  const { is3D: is3DMode, setIs3D: setIs3DMode } = useSharedTerrain3D(false);
  const { onTerrainUnavailable, terrainNotice } = useTerrainFallback(() => setIs3DMode(false));
  const [currentCenter, setCurrentCenter] = useState<LngLat | null>(null);
  const [currentZoom, setCurrentZoom] = useState(10);
  const [currentBounds, setCurrentBounds] = useState<LngLatBounds | null>(null);

  const surfaceRef = useRef<MapSurfaceRef>(null);
  const bearingAnim = useRef(new Animated.Value(0)).current;

  const routeCoords = useMemo(
    () => (routeCoordinates ? lngLatFromTuples(routeCoordinates) : []),
    [routeCoordinates]
  );
  const has3DRoute = routeCoords.length > 0;

  // Stop the in-flight animation on unmount to prevent updates on an unmounted component
  useEffect(() => {
    return () => {
      bearingAnim.stopAnimation();
    };
  }, [bearingAnim]);

  const handleBearingChange = useCallback(
    (bearing: number) => {
      bearingAnim.setValue(-bearing);
    },
    [bearingAnim]
  );

  const toggle3D = useCallback(() => {
    setIs3DMode((current) => !current);
  }, [setIs3DMode]);

  const resetOrientation = useCallback(() => {
    surfaceRef.current?.resetOrientation();
  }, []);

  // Track centre and zoom so satellite attribution follows the viewport.
  const handleRegionDidChange = useCallback(
    (state: { center: LngLat; zoom: number; bounds?: LngLatBounds }) => {
      setCurrentCenter(state.center);
      setCurrentBounds(state.bounds ?? null);
      setCurrentZoom(state.zoom);
    },
    []
  );

  const { userLocation, locationLoading, locate } = useLocateUser();
  const handleGetLocation = useCallback(() => {
    void locate(surfaceRef.current);
  }, [locate]);

  const fitCamera = useMemo(() => {
    const fitBounds: LngLatBounds | undefined = bounds
      ? { sw: bounds.sw, ne: bounds.ne }
      : undefined;
    return { bounds: fitBounds, padding };
  }, [bounds, padding]);

  const userLocationCollection = useMemo(
    () => buildUserLocationCollection(userLocation),
    [userLocation]
  );

  const sources = useMemo<Record<string, MapSourceSpec>>(
    () => ({
      // line-gradient addresses the route by line-progress, which needs line
      // metrics; the source stays the same whether a ramp is drawn or not.
      route: {
        kind: 'geojson',
        data: featureCollection([lineFeature(routeCoords)]),
        lineMetrics: true,
      },
      ...overlaySources,
      [USER_LOCATION_SOURCE_ID]: { kind: 'geojson', data: userLocationCollection },
    }),
    [routeCoords, overlaySources, userLocationCollection]
  );

  const terrain = useMemo<MapTerrainSpec | null>(
    () =>
      is3DMode
        ? {
            exaggeration: TERRAIN_3D_CONFIG.defaultExaggeration,
            pitch: TERRAIN_3D_CONFIG.defaultPitch,
          }
        : null,
    [is3DMode]
  );

  const palette = mapPalette(mapStyle);
  const routeLineGradient = useMemo(
    () => routeGradient?.(palette) ?? null,
    [routeGradient, palette]
  );
  const mapLayers = useMemo<MapLayerSpec[]>(
    () =>
      composeBaseMapLayers({
        palette,
        routeColor,
        routeContext,
        routeGradient: routeLineGradient,
        underRouteLayers: underRouteLayers(palette, is3DMode),
        overlayLayers: overlayLayers(palette, is3DMode),
        userLocationLayers: buildUserLocationLayers(userLocation !== null, palette),
      }),
    [
      palette,
      routeColor,
      routeContext,
      routeLineGradient,
      underRouteLayers,
      overlayLayers,
      is3DMode,
      userLocation,
    ]
  );

  // Satellite mode reads its attribution from the viewport, so the sources named
  // are the ones on screen. Shared with the activity and regional maps.
  const attributionText = useMemo(
    () =>
      computeAttribution({
        style: mapStyle,
        is3D: is3DMode,
        center: currentCenter,
        zoom: currentZoom,
        bounds: currentBounds,
      }),
    [mapStyle, currentCenter, currentZoom, currentBounds, is3DMode]
  );
  const attributionRef = useRef<AttributionOverlayRef>(null);
  useEffect(() => {
    attributionRef.current?.setAttribution(attributionText);
  }, [attributionText]);

  // Render controls
  const renderControls = () => (
    <>
      {/* Close button */}
      {onClose ? (
        <MapControlButton
          testID="map-fullscreen-close"
          style={[styles.button, styles.closeButton, { top: insets.top + 12 }]}
          onPress={onClose}
          accessibilityLabel={t('maps.closeMap')}
        >
          <MapControlButton.Glyph name="close" />
        </MapControlButton>
      ) : null}

      {/* Style toggle */}
      {showStyleToggle ? (
        <MapControlButton
          testID="map-style-toggle"
          style={[styles.button, styles.styleButton, { top: insets.top + 12 }]}
          onPress={toggleStyle}
          accessibilityLabel={t('maps.toggleStyle')}
        >
          <MapControlButton.Glyph name={getStyleIcon(nextStyle)} />
        </MapControlButton>
      ) : null}

      {/* Control stack - positioned at same level as style toggle, horizontal layout */}
      <View style={[styles.controlStack, { top: insets.top + 12 }]}>
        {show3DToggle && has3DRoute ? (
          <MapControlButton
            testID="map-3d-toggle"
            onPress={toggle3D}
            selected={is3DMode}
            accessibilityLabel={is3DMode ? t('maps.disable3D') : t('maps.enable3D')}
          >
            <MapControlButton.Glyph name="terrain" />
          </MapControlButton>
        ) : null}

        {showOrientationButton ? (
          <MapControlButton
            onPress={resetOrientation}
            accessibilityLabel={t('maps.resetOrientation')}
          >
            <MapControlButton.Compass rotation={bearingAnim} />
          </MapControlButton>
        ) : null}

        {showLocationButton ? (
          <MapControlButton
            onPress={handleGetLocation}
            disabled={locationLoading}
            selected={userLocation !== null}
            accessibilityLabel={t('maps.goToLocation')}
            accessibilityState={{ busy: locationLoading }}
          >
            {locationLoading ? (
              <MapControlButton.Spinner />
            ) : (
              <MapControlButton.Glyph name={LOCATE_GLYPH} />
            )}
          </MapControlButton>
        ) : null}

        {extraControls}
      </View>

      {showAttribution ? (
        <AttributionOverlay
          ref={attributionRef}
          initialAttribution={attributionText}
          bottomInset={insets.bottom}
        />
      ) : null}
    </>
  );

  return (
    <View style={styles.container}>
      <View style={styles.mapLayer}>
        <MapSurface
          ref={surfaceRef}
          mapStyle={mapStyle}
          initialCamera={fitCamera}
          sources={sources}
          layers={mapLayers}
          images={overlayImages}
          interactiveLayers={interactiveLayers}
          terrain={terrain}
          onPress={onPress}
          onRegionIsChanging={(state) => handleBearingChange(state.bearing)}
          onRegionDidChange={handleRegionDidChange}
          onTerrainUnavailable={onTerrainUnavailable}
        />
      </View>

      {terrainNotice}

      {/* Controls overlay */}
      {renderControls()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: darkColors.surfacePage,
  },
  mapLayer: {
    ...StyleSheet.absoluteFill,
  },
  button: {
    position: 'absolute',
    zIndex: layers.mapOverlay,
  },
  closeButton: {
    left: spacing.md,
  },
  styleButton: {
    right: spacing.md,
  },
  controlStack: {
    position: 'absolute',
    // To the left of the style toggle, one control and the gap between two away.
    right: spacing.md + MAP_CONTROL_SIZE + MAP_CONTROL_GAP,
    flexDirection: 'row', // Horizontal layout to reduce vertical occlusion
    gap: MAP_CONTROL_GAP,
    zIndex: layers.mapOverlay,
  },
});

export type { MapPressEvent };
