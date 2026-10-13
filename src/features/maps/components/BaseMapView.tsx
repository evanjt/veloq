import React, { useState, useCallback, useRef, useMemo, ReactNode, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, ActivityIndicator } from 'react-native';
import { useTheme } from '@/shared/app';
// Straight from the context, not the app barrel: a surface mounted with no
// app shell still has to draw, and the barrel is what such a caller stubs.
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  colors,
  darkColors,
  spacing,
  layout,
  shadows,
  typography,
  colorWithOpacity,
  ink,
} from '@/theme';
import { Map3DWebView, type Map3DWebViewRef } from './Map3DWebView';
import { MapSurface, type MapPressEvent, type MapSurfaceRef } from './MapSurface';
import { CompassArrow, ComponentErrorBoundary, IconButton } from '@/shared/ui';
import {
  featureCollection,
  lineFeature,
  lngLatFromTuples,
  type LngLat,
  type LngLatBounds,
} from '@/features/maps/lib/coordinates';
import type { MapImageSpec, MapLayerSpec, MapSourceSpec } from '@/features/maps/lib/htmlBuilders';
import { type MapStyleType, isDarkStyle, getNextStyle, getStyleIcon } from './mapStyles';
import { composeBaseMapLayers } from '@/features/maps/lib/baseMapLayers';
import { computeAttribution } from '@/features/maps/lib/computeAttribution';
import { cameraAfter3D, type Camera3DState } from '@/features/maps/lib/cameraAfter3D';
import { useDrawnMapStyle } from '@/features/maps/hooks/useDrawnMapStyle';
import { useLocateUser } from '@/features/maps/hooks/useLocateUser';
import { useTerrainFallback } from '@/features/maps/hooks/useTerrainFallback';
import {
  USER_LOCATION_SOURCE_ID,
  buildUserLocationCollection,
  buildUserLocationLayers,
} from '@/features/maps/lib/userLocationLayer';
import { motionTiming } from '@/shared/ui/reduceMotion';

/** Room left around fitted bounds, in pixels. Extra on top for the controls. */
const DEFAULT_FIT_PADDING = { top: 80, right: 40, bottom: 40, left: 40 } as const;

/**
 * What the caller draws over the route in 3D, in the terrain page's own
 * collections, and the section tap it answers. The page cannot read the flat
 * map's layer specs, so a caller that draws overlays in 2D hands the same data
 * here in this form.
 */
export type BaseMap3DLayer = Pick<
  React.ComponentProps<typeof Map3DWebView>,
  | 'routesGeoJSON'
  | 'sectionsGeoJSON'
  | 'tracesGeoJSON'
  | 'sectionMarkersGeoJSON'
  | 'sectionTrimGeoJSON'
  | 'highlightedTraceGeoJSON'
  | 'onSectionClick'
>;

export interface BaseMapViewProps {
  /** Route coordinates as [lng, lat] pairs for GeoJSON */
  routeCoordinates?: LngLat[] | undefined;
  /** Route line color */
  routeColor?: string | undefined;
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
  /** Extra layers over the route, in draw order. */
  overlayLayers?: MapLayerSpec[] | undefined;
  /** Extra layers beneath the route line, in draw order; they read the overlay sources. */
  underRouteLayers?: MapLayerSpec[] | undefined;
  /** Images the overlay layers reference by id. */
  overlayImages?: MapImageSpec[] | undefined;
  /** Overlay layers that respond to a tap, most specific first. */
  interactiveLayers?: string[] | undefined;
  /** The overlays and the section tap in the form the 3D layer takes. */
  layer3D?: BaseMap3DLayer | undefined;
  /** Custom control buttons to add to the control stack */
  extraControls?: ReactNode | undefined;
  /** Close button handler (for fullscreen maps) */
  onClose?: (() => void) | undefined;
}

const NO_SOURCES: Record<string, MapSourceSpec> = {};
const NO_LAYERS: MapLayerSpec[] = [];

export function BaseMapView({
  routeCoordinates,
  routeColor = colors.primary,
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
  layer3D,
  extraControls,
  onClose,
}: BaseMapViewProps) {
  const { t } = useTranslation();
  const { isDark: systemIsDark } = useTheme();
  const insets = useSafeAreaInsets();
  const systemStyle: MapStyleType = systemIsDark ? 'dark' : 'light';

  const [chosenStyle, setChosenStyle] = useState<MapStyleType>(initialStyle ?? systemStyle);
  const mapStyle = useDrawnMapStyle(chosenStyle);
  const [is3DMode, setIs3DMode] = useState(false);
  const [is3DReady, setIs3DReady] = useState(false);
  const { onTerrainUnavailable, terrainNotice } = useTerrainFallback(() => {
    setIs3DReady(false);
    setIs3DMode(false);
  });
  const [currentCenter, setCurrentCenter] = useState<LngLat | null>(null);
  const [currentZoom, setCurrentZoom] = useState(10);
  const [currentBounds, setCurrentBounds] = useState<LngLatBounds | null>(null);

  const surfaceRef = useRef<MapSurfaceRef>(null);
  const map3DRef = useRef<Map3DWebViewRef>(null);
  const bearingAnim = useRef(new Animated.Value(0)).current;
  const map3DOpacity = useRef(new Animated.Value(0)).current;

  const isDark = isDarkStyle(mapStyle);
  const routeCoords = useMemo(
    () => (routeCoordinates ? lngLatFromTuples(routeCoordinates) : []),
    [routeCoordinates]
  );
  const has3DRoute = routeCoords.length > 0;

  // Stop in-flight animations on unmount to prevent updates on unmounted component
  useEffect(() => {
    return () => {
      map3DOpacity.stopAnimation();
      bearingAnim.stopAnimation();
    };
  }, [map3DOpacity, bearingAnim]);

  // Reset 3D ready state when toggling off. The flag is dropped while
  // rendering so no frame commits as ready with 3D already off; the fade is an
  // animation and stays in the effect.
  if (!is3DMode && is3DReady) {
    setIs3DReady(false);
  }
  useEffect(() => {
    if (!is3DMode) {
      map3DOpacity.setValue(0);
    }
  }, [is3DMode, map3DOpacity]);

  // Handle 3D map ready - fade in the 3D view
  const handleMap3DReady = useCallback(() => {
    setIs3DReady(true);
    motionTiming(map3DOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [map3DOpacity]);

  const handleBearingChange = useCallback(
    (bearing: number) => {
      bearingAnim.setValue(-bearing);
    },
    [bearingAnim]
  );

  const toggleStyle = useCallback(() => {
    setChosenStyle((current) => getNextStyle(current));
  }, []);

  const toggle3D = useCallback(() => {
    setIs3DMode((current) => !current);
  }, []);

  const resetOrientation = useCallback(() => {
    if (is3DMode && is3DReady) {
      map3DRef.current?.resetOrientation();
    } else {
      surfaceRef.current?.resetOrientation();
    }
  }, [is3DMode, is3DReady]);

  // Track centre and zoom so satellite attribution follows the viewport.
  // Also kept in a ref: the surface is unmounted whenever the 3D layer covers
  // it, and it has to come back on the viewport the user left rather than on
  // the fitted track again.
  const settledCameraRef = useRef<{ center: LngLat; zoom: number } | null>(null);
  const handleRegionDidChange = useCallback(
    (state: { center: LngLat; zoom: number; bounds?: LngLatBounds }) => {
      setCurrentCenter(state.center);
      setCurrentBounds(state.bounds ?? null);
      setCurrentZoom(state.zoom);
      settledCameraRef.current = { center: state.center, zoom: state.zoom };
    },
    []
  );

  // The camera on screen is the one the locate flow moves; the dot is drawn
  // on the 2D surface only.
  const { userLocation, locationLoading, locate } = useLocateUser();
  const handleGetLocation = useCallback(() => {
    void locate(is3DMode && is3DReady ? map3DRef.current : surfaceRef.current);
  }, [locate, is3DMode, is3DReady]);

  // The 2D surface comes down once the 3D layer covers it, so where it was is
  // captured on the way out. The remount opens where the 3D camera was left,
  // or where 2D was if the 3D one never reported. The surface reads its camera
  // only when it mounts, so the 3D one is read from the ref at that render and
  // a pan in 3D re-renders nothing.
  const show2DSurface = !(is3DMode && is3DReady);
  const [cameraOnHide, setCameraOnHide] = useState<{ center: LngLat; zoom: number } | null>(null);
  const camera3DRef = useRef<Camera3DState | null>(null);
  useEffect(() => {
    if (!show2DSurface) setCameraOnHide(settledCameraRef.current);
  }, [show2DSurface]);
  // A camera from an earlier 3D visit is not where this one was left.
  useEffect(() => {
    if (is3DMode) camera3DRef.current = null;
  }, [is3DMode]);
  const handleCamera3DChange = useCallback((camera: Camera3DState) => {
    camera3DRef.current = camera;
  }, []);

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
      route: { kind: 'geojson', data: featureCollection([lineFeature(routeCoords)]) },
      ...overlaySources,
      [USER_LOCATION_SOURCE_ID]: { kind: 'geojson', data: userLocationCollection },
    }),
    [routeCoords, overlaySources, userLocationCollection]
  );

  const layers = useMemo<MapLayerSpec[]>(
    () =>
      composeBaseMapLayers({
        routeColor,
        underRouteLayers,
        overlayLayers,
        userLocationLayers: buildUserLocationLayers(userLocation !== null),
      }),
    [routeColor, underRouteLayers, overlayLayers, userLocation]
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

  // Render controls (shared between 2D and 3D)
  const renderControls = () => (
    <>
      {/* Close button */}
      {onClose ? (
        <IconButton
          testID="map-fullscreen-close"
          style={[
            styles.button,
            styles.closeButton,
            { top: insets.top + 12 },
            isDark && styles.buttonDark,
          ]}
          onPress={onClose}
          variant="secondary"
          accessibilityLabel={t('maps.closeMap')}
        >
          <MaterialCommunityIcons
            name="close"
            size={24}
            color={isDark ? colors.textOnDark : colors.textSecondary}
          />
        </IconButton>
      ) : null}

      {/* Style toggle */}
      {showStyleToggle ? (
        <IconButton
          testID="map-style-toggle"
          style={[
            styles.button,
            styles.styleButton,
            { top: insets.top + 12 },
            isDark && styles.buttonDark,
          ]}
          onPress={toggleStyle}
          variant="secondary"
          accessibilityLabel={t('maps.toggleStyle')}
        >
          <MaterialCommunityIcons
            name={getStyleIcon(mapStyle)}
            size={24}
            color={isDark ? colors.textOnDark : colors.textSecondary}
          />
        </IconButton>
      ) : null}

      {/* Control stack - positioned at same level as style toggle, horizontal layout */}
      <View style={[styles.controlStack, { top: insets.top + 12 }]}>
        {show3DToggle && has3DRoute ? (
          <IconButton
            testID="map-3d-toggle"
            style={[styles.controlButton, isDark && !is3DMode && styles.controlButtonDark]}
            onPress={toggle3D}
            variant={is3DMode ? 'primary' : 'secondary'}
            accessibilityLabel={is3DMode ? t('maps.disable3D') : t('maps.enable3D')}
          >
            <MaterialCommunityIcons
              name="terrain"
              size={22}
              color={
                is3DMode ? colors.textOnPrimary : isDark ? colors.textOnDark : colors.textSecondary
              }
            />
          </IconButton>
        ) : null}

        {showOrientationButton ? (
          <IconButton
            style={[styles.controlButton, isDark && styles.controlButtonDark]}
            onPress={resetOrientation}
            variant="secondary"
            accessibilityLabel={t('maps.resetOrientation')}
          >
            <CompassArrow
              size={22}
              rotation={bearingAnim}
              northColor={colors.error}
              southColor={isDark ? colors.textOnDark : colors.textSecondary}
            />
          </IconButton>
        ) : null}

        {showLocationButton ? (
          <IconButton
            style={[styles.controlButton, isDark && !userLocation && styles.controlButtonDark]}
            onPress={handleGetLocation}
            disabled={locationLoading}
            variant={userLocation ? 'primary' : 'secondary'}
            accessibilityLabel={t('maps.goToLocation')}
            accessibilityState={{ disabled: locationLoading, busy: locationLoading }}
          >
            {locationLoading ? (
              <ActivityIndicator
                size="small"
                color={isDark ? colors.textOnDark : colors.textSecondary}
              />
            ) : (
              <MaterialCommunityIcons
                name="crosshairs-gps"
                size={22}
                color={
                  userLocation
                    ? colors.textOnPrimary
                    : isDark
                      ? colors.textOnDark
                      : colors.textSecondary
                }
              />
            )}
          </IconButton>
        ) : null}

        {extraControls}
      </View>

      {/* Attribution */}
      {showAttribution ? (
        <View style={[styles.attribution, { bottom: insets.bottom }]} pointerEvents="none">
          <View style={[styles.attributionPill, isDark && styles.attributionPillDark]}>
            <Text style={[styles.attributionText, isDark && styles.attributionTextDark]}>
              {attributionText}
            </Text>
          </View>
        </View>
      ) : null}
    </>
  );

  return (
    <View style={styles.container}>
      {/* 2D Map. Unmounted once the 3D layer covers it: a hidden WebView keeps
          its GL context and its tile textures alive for nobody. */}
      {show2DSurface ? (
        <View style={styles.mapLayer}>
          <MapSurface
            ref={surfaceRef}
            mapStyle={mapStyle}
            initialCamera={cameraAfter3D(camera3DRef.current, cameraOnHide) ?? fitCamera}
            sources={sources}
            layers={layers}
            images={overlayImages}
            interactiveLayers={interactiveLayers}
            onPress={onPress}
            onRegionIsChanging={(state) => handleBearingChange(state.bearing)}
            onRegionDidChange={handleRegionDidChange}
          />
        </View>
      ) : null}

      {/* 3D Map - rendered when 3D mode is on, fades in when ready */}
      {/* Error boundary prevents a 3D crash from taking out the entire map */}
      {is3DMode && has3DRoute ? (
        <ComponentErrorBoundary part="map3d" debugName="3D Map" onError={() => setIs3DMode(false)}>
          <Animated.View
            style={[styles.mapLayer, styles.map3DLayer, { opacity: map3DOpacity }]}
            pointerEvents={is3DReady ? 'auto' : 'none'}
          >
            <Map3DWebView
              {...layer3D}
              ref={map3DRef}
              coordinates={routeCoords}
              mapStyle={mapStyle}
              routeColor={routeColor}
              onMapReady={handleMap3DReady}
              onMapFailed={() => setIs3DMode(false)}
              onTerrainUnavailable={onTerrainUnavailable}
              onBearingChange={handleBearingChange}
              onCameraStateChange={handleCamera3DChange}
            />
          </Animated.View>
        </ComponentErrorBoundary>
      ) : null}

      {terrainNotice}

      {/* Controls overlay */}
      {renderControls()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: darkColors.background,
  },
  mapLayer: {
    ...StyleSheet.absoluteFill,
  },
  map3DLayer: {
    zIndex: 1,
  },
  button: {
    position: 'absolute',
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    borderRadius: layout.minTapTarget / 2,
    ...shadows.mapOverlay,
    zIndex: 10,
  },
  buttonDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  closeButton: {
    left: spacing.md,
  },
  styleButton: {
    right: spacing.md,
  },
  controlStack: {
    position: 'absolute',
    right: spacing.md + 52, // Position to left of style toggle button (44px button + 8px gap)
    flexDirection: 'row', // Horizontal layout to reduce vertical occlusion
    gap: spacing.sm,
    zIndex: 10,
  },
  controlButton: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    borderRadius: layout.minTapTarget / 2,
    ...shadows.mapOverlay,
  },
  controlButtonDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  attribution: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    alignItems: 'flex-end',
    paddingBottom: spacing.xs,
    paddingRight: spacing.xsPlus,
    zIndex: 5,
  },
  attributionPill: {
    backgroundColor: colorWithOpacity(ink.white, 0.7),
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
  },
  attributionPillDark: {
    backgroundColor: colorWithOpacity(darkColors.surfaceElevated, 0.8),
  },
  attributionText: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
  },
  attributionTextDark: {
    color: darkColors.textSecondary,
  },
});

export type { MapPressEvent };
