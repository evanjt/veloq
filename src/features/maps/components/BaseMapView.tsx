import React, { useState, useCallback, useRef, useMemo, ReactNode, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { useTheme } from '@/shared/app';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import { colors, darkColors, mapLayerColors, spacing, layout, shadows } from '@/theme';
import { Map3DWebView, type Map3DWebViewRef } from './Map3DWebView';
import { TerrainUnavailableNotice } from './TerrainUnavailableNotice';
import { MapSurface, type MapPressEvent, type MapSurfaceRef } from './MapSurface';
import { CompassArrow, ComponentErrorBoundary } from '@/shared/ui';
import {
  featureCollection,
  lineFeature,
  lngLatFromTuples,
  type LngLat,
  type LngLatBounds,
} from '@/features/maps/lib/coordinates';
import type { MapImageSpec, MapLayerSpec, MapSourceSpec } from '@/features/maps/lib/htmlBuilders';
import {
  type MapStyleType,
  isDarkStyle,
  getNextStyle,
  getStyleIcon,
  MAP_ATTRIBUTIONS,
  TERRAIN_ATTRIBUTION,
  getCombinedSatelliteAttribution,
} from './mapStyles';

/** Room left around fitted bounds, in pixels. Extra on top for the controls. */
const DEFAULT_FIT_PADDING = { top: 80, right: 40, bottom: 40, left: 40 } as const;

export interface BaseMapViewProps {
  /** Route coordinates as [lng, lat] pairs for GeoJSON */
  routeCoordinates?: LngLat[];
  /** Route line color */
  routeColor?: string;
  /** Bounds to fit camera to */
  bounds?: { ne: LngLat; sw: LngLat };
  /** Camera padding in pixels */
  padding?: { top: number; right: number; bottom: number; left: number };
  /** Initial map style */
  initialStyle?: MapStyleType;
  /** Show style toggle button */
  showStyleToggle?: boolean;
  /** Show 3D toggle button */
  show3DToggle?: boolean;
  /** Show orientation/compass button */
  showOrientationButton?: boolean;
  /** Show location button */
  showLocationButton?: boolean;
  /** Show attribution */
  showAttribution?: boolean;
  /** Called when map is pressed */
  onPress?: (event: MapPressEvent) => void;
  /**
   * Extra sources the caller wants drawn over the route, keyed by id. Declared
   * as data rather than passed as JSX so the same description works whichever
   * renderer is behind the surface.
   */
  overlaySources?: Record<string, MapSourceSpec>;
  /** Extra layers over the route, in draw order. */
  overlayLayers?: MapLayerSpec[];
  /** Images the overlay layers reference by id. */
  overlayImages?: MapImageSpec[];
  /** Overlay layers that respond to a tap, most specific first. */
  interactiveLayers?: string[];
  /** Custom control buttons to add to the control stack */
  extraControls?: ReactNode;
  /** Close button handler (for fullscreen maps) */
  onClose?: () => void;
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
  overlayImages,
  interactiveLayers,
  extraControls,
  onClose,
}: BaseMapViewProps) {
  const { t } = useTranslation();
  const { isDark: systemIsDark } = useTheme();
  const insets = useSafeAreaInsets();
  const systemStyle: MapStyleType = systemIsDark ? 'dark' : 'light';

  const [mapStyle, setMapStyle] = useState<MapStyleType>(initialStyle ?? systemStyle);
  const [is3DMode, setIs3DMode] = useState(false);
  const [is3DReady, setIs3DReady] = useState(false);
  const [terrainUnavailable, setTerrainUnavailable] = useState(false);

  // The page drew, it just had no DEM tiles, so 3D is the flat map with a
  // wasted WebView on top. Drop back and say why, rather than leave it (`B131`).
  const handleTerrainUnavailable = useCallback(() => {
    setIs3DReady(false);
    setIs3DMode(false);
    setTerrainUnavailable(true);
  }, []);
  const [currentCenter, setCurrentCenter] = useState<LngLat | null>(null);
  const [currentZoom, setCurrentZoom] = useState(10);

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

  // Reset 3D ready state when toggling off
  useEffect(() => {
    if (!is3DMode) {
      setIs3DReady(false);
      map3DOpacity.setValue(0);
    }
  }, [is3DMode, map3DOpacity]);

  // Handle 3D map ready - fade in the 3D view
  const handleMap3DReady = useCallback(() => {
    setIs3DReady(true);
    Animated.timing(map3DOpacity, {
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
    setMapStyle((current) => getNextStyle(current));
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
    Animated.timing(bearingAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [is3DMode, is3DReady, bearingAnim]);

  // Track centre and zoom so satellite attribution follows the viewport.
  const handleRegionDidChange = useCallback((state: { center: LngLat; zoom: number }) => {
    setCurrentCenter(state.center);
    setCurrentZoom(state.zoom);
  }, []);

  // Get user location and refocus camera
  const handleGetLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      surfaceRef.current?.setCamera(
        { center: [location.coords.longitude, location.coords.latitude], zoom: 14 },
        500
      );
    } catch {
      // Silently fail - location is optional
    }
  }, []);

  const initialCamera = useMemo(() => {
    const fitBounds: LngLatBounds | undefined = bounds
      ? { sw: bounds.sw, ne: bounds.ne }
      : undefined;
    return { bounds: fitBounds, padding };
  }, [bounds, padding]);

  const sources = useMemo<Record<string, MapSourceSpec>>(
    () => ({
      route: { kind: 'geojson', data: featureCollection([lineFeature(routeCoords)]) },
      ...overlaySources,
    }),
    [routeCoords, overlaySources]
  );

  const layers = useMemo<MapLayerSpec[]>(
    () => [
      {
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': mapLayerColors.casing, 'line-width': 5 },
      },
      {
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': routeColor, 'line-width': 4 },
      },
      ...overlayLayers,
    ],
    [routeColor, overlayLayers]
  );

  // Dynamic attribution based on map style and current location
  // For satellite mode, shows regional attributions (swisstopo, IGN, etc.) based on map center
  const attributionText = useMemo(() => {
    if (mapStyle === 'satellite' && currentCenter) {
      const satAttribution = getCombinedSatelliteAttribution(
        currentCenter[1], // lat
        currentCenter[0], // lng
        currentZoom
      );
      return is3DMode ? `${satAttribution} | ${TERRAIN_ATTRIBUTION}` : satAttribution;
    }
    const baseAttribution = MAP_ATTRIBUTIONS[mapStyle];
    return is3DMode ? `${baseAttribution} | ${TERRAIN_ATTRIBUTION}` : baseAttribution;
  }, [mapStyle, currentCenter, currentZoom, is3DMode]);

  // Render controls (shared between 2D and 3D)
  const renderControls = () => (
    <>
      {/* Close button */}
      {onClose && (
        <TouchableOpacity
          testID="map-fullscreen-close"
          style={[
            styles.button,
            styles.closeButton,
            { top: insets.top + 12 },
            isDark && styles.buttonDark,
          ]}
          onPress={onClose}
          activeOpacity={0.8}
          accessibilityLabel={t('maps.closeMap')}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons
            name="close"
            size={24}
            color={isDark ? colors.textOnDark : colors.textSecondary}
          />
        </TouchableOpacity>
      )}

      {/* Style toggle */}
      {showStyleToggle && (
        <TouchableOpacity
          testID="map-style-toggle"
          style={[
            styles.button,
            styles.styleButton,
            { top: insets.top + 12 },
            isDark && styles.buttonDark,
          ]}
          onPress={toggleStyle}
          activeOpacity={0.8}
          accessibilityLabel={t('maps.toggleStyle')}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons
            name={getStyleIcon(mapStyle)}
            size={24}
            color={isDark ? colors.textOnDark : colors.textSecondary}
          />
        </TouchableOpacity>
      )}

      {/* Control stack - positioned at same level as style toggle, horizontal layout */}
      <View style={[styles.controlStack, { top: insets.top + 12 }]}>
        {show3DToggle && has3DRoute && (
          <TouchableOpacity
            testID="map-3d-toggle"
            style={[
              styles.controlButton,
              isDark && styles.controlButtonDark,
              is3DMode && styles.controlButtonActive,
            ]}
            onPress={toggle3D}
            activeOpacity={0.8}
            accessibilityLabel={is3DMode ? t('maps.disable3D') : t('maps.enable3D')}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons
              name="terrain"
              size={22}
              color={
                is3DMode ? colors.textOnDark : isDark ? colors.textOnDark : colors.textSecondary
              }
            />
          </TouchableOpacity>
        )}

        {showOrientationButton && (
          <TouchableOpacity
            style={[styles.controlButton, isDark && styles.controlButtonDark]}
            onPress={resetOrientation}
            activeOpacity={0.8}
            accessibilityLabel={t('maps.resetOrientation')}
            accessibilityRole="button"
          >
            <CompassArrow
              size={22}
              rotation={bearingAnim}
              northColor={colors.error}
              southColor={isDark ? colors.textOnDark : colors.textSecondary}
            />
          </TouchableOpacity>
        )}

        {showLocationButton && (
          <TouchableOpacity
            style={[styles.controlButton, isDark && styles.controlButtonDark]}
            onPress={handleGetLocation}
            activeOpacity={0.8}
            accessibilityLabel={t('maps.goToLocation')}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons
              name="crosshairs-gps"
              size={22}
              color={isDark ? colors.textOnDark : colors.textSecondary}
            />
          </TouchableOpacity>
        )}

        {extraControls}
      </View>

      {/* Attribution */}
      {showAttribution && (
        <View style={[styles.attribution, { bottom: insets.bottom }]} pointerEvents="none">
          <View style={styles.attributionPill}>
            <Text style={styles.attributionText}>{attributionText}</Text>
          </View>
        </View>
      )}
    </>
  );

  return (
    <View style={styles.container}>
      {/* 2D Map - always rendered, hidden when 3D is ready */}
      <View style={[styles.mapLayer, is3DMode && is3DReady && styles.hiddenLayer]}>
        <MapSurface
          ref={surfaceRef}
          mapStyle={mapStyle}
          initialCamera={initialCamera}
          sources={sources}
          layers={layers}
          images={overlayImages}
          interactiveLayers={interactiveLayers}
          onPress={onPress}
          onRegionIsChanging={(state) => bearingAnim.setValue(-state.bearing)}
          onRegionDidChange={handleRegionDidChange}
        />
      </View>

      {/* 3D Map - rendered when 3D mode is on, fades in when ready */}
      {/* Error boundary prevents a 3D crash from taking out the entire map */}
      {is3DMode && has3DRoute && (
        <ComponentErrorBoundary
          componentName="3D Map"
          showRetry={false}
          onError={() => setIs3DMode(false)}
        >
          <Animated.View
            style={[styles.mapLayer, styles.map3DLayer, { opacity: map3DOpacity }]}
            pointerEvents={is3DReady ? 'auto' : 'none'}
          >
            <Map3DWebView
              ref={map3DRef}
              coordinates={routeCoords}
              mapStyle={mapStyle}
              routeColor={routeColor}
              onMapReady={handleMap3DReady}
              onMapFailed={() => setIs3DMode(false)}
              onTerrainUnavailable={handleTerrainUnavailable}
              onBearingChange={handleBearingChange}
            />
          </Animated.View>
        </ComponentErrorBoundary>
      )}

      {terrainUnavailable && (
        <TerrainUnavailableNotice onDismiss={() => setTerrainUnavailable(false)} />
      )}

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
  hiddenLayer: {
    opacity: 0,
    pointerEvents: 'none',
  },
  button: {
    position: 'absolute',
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    borderRadius: layout.minTapTarget / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
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
    width: layout.minTapTarget, // 44 - Accessibility minimum
    height: layout.minTapTarget, // 44 - Accessibility minimum
    borderRadius: layout.minTapTarget / 2, // 22
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.mapOverlay,
  },
  controlButtonDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  controlButtonActive: {
    backgroundColor: colors.primary,
  },
  attribution: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    alignItems: 'flex-end',
    paddingBottom: 4,
    paddingRight: 6,
    zIndex: 5,
  },
  attributionPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: spacing.sm,
  },
  attributionText: {
    fontSize: 9,
    color: colors.textSecondary,
  },
});

export type { MapPressEvent };
