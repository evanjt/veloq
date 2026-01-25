import React, { useState, useCallback, useRef, useMemo, ReactNode, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Platform } from 'react-native';
import { useTheme } from '@/hooks';
import {
  MapView,
  Camera,
  ShapeSource,
  LineLayer,
  MarkerView,
} from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import { colors, darkColors, opacity } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import { shadows } from '@/theme/shadows';
import { Map3DWebView, type Map3DWebViewRef } from './Map3DWebView';
import { CompassArrow } from '@/components/ui';
import {
  type MapStyleType,
  getMapStyle,
  isDarkStyle,
  getNextStyle,
  getStyleIcon,
  MAP_ATTRIBUTIONS,
  TERRAIN_ATTRIBUTION,
  getCombinedSatelliteAttribution,
} from './mapStyles';

export interface BaseMapViewProps {
  /** Route coordinates as [lng, lat] pairs for GeoJSON */
  routeCoordinates?: [number, number][];
  /** Route line color */
  routeColor?: string;
  /** Bounds to fit camera to */
  bounds?: { ne: [number, number]; sw: [number, number] };
  /** Camera padding */
  padding?: {
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
  };
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
  onPress?: (event: GeoJSON.Feature) => void;
  /** Custom markers to render */
  children?: ReactNode;
  /** Custom control buttons to add to the control stack */
  extraControls?: ReactNode;
  /** Ref to access camera methods */
  cameraRef?: React.RefObject<React.ElementRef<typeof Camera>>;
  /** Close button handler (for fullscreen maps) */
  onClose?: () => void;
}

export interface BaseMapViewRef {
  setCamera: (options: {
    centerCoordinate?: [number, number];
    zoomLevel?: number;
    heading?: number;
    animationDuration?: number;
  }) => void;
  fitBounds: (
    ne: [number, number],
    sw: [number, number],
    padding?: number,
    duration?: number
  ) => void;
}

export function BaseMapView({
  routeCoordinates,
  routeColor = colors.primary,
  bounds,
  padding = {
    paddingTop: 80,
    paddingRight: 40,
    paddingBottom: 40,
    paddingLeft: 40,
  },
  initialStyle,
  showStyleToggle = true,
  show3DToggle = true,
  showOrientationButton = true,
  showLocationButton = true,
  showAttribution = true,
  onPress,
  children,
  extraControls,
  cameraRef: externalCameraRef,
  onClose,
}: BaseMapViewProps) {
  const { t } = useTranslation();
  const { isDark: systemIsDark } = useTheme();
  const insets = useSafeAreaInsets();
  const systemStyle: MapStyleType = systemIsDark ? 'dark' : 'light';

  const [mapStyle, setMapStyle] = useState<MapStyleType>(initialStyle ?? systemStyle);
  const [is3DMode, setIs3DMode] = useState(false);
  const [is3DReady, setIs3DReady] = useState(false);
  const [currentCenter, setCurrentCenter] = useState<[number, number] | null>(null);
  const [currentZoom, setCurrentZoom] = useState(10);

  // iOS simulator tile loading retry mechanism
  const [mapKey, setMapKey] = useState(0);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000;

  const handleMapLoadError = useCallback(() => {
    if (Platform.OS === 'ios' && retryCountRef.current < MAX_RETRIES) {
      retryCountRef.current += 1;
      console.log(`[Map] Load failed, retrying (${retryCountRef.current}/${MAX_RETRIES})...`);
      setTimeout(() => {
        setMapKey((k) => k + 1);
      }, RETRY_DELAY_MS * retryCountRef.current); // Exponential backoff
    }
  }, []);

  // Reset retry count when style changes
  useEffect(() => {
    retryCountRef.current = 0;
  }, [mapStyle]);

  const internalCameraRef = useRef<React.ElementRef<typeof Camera>>(null);
  const cameraRef = externalCameraRef || internalCameraRef;
  const map3DRef = useRef<Map3DWebViewRef>(null);
  const bearingAnim = useRef(new Animated.Value(0)).current;
  const map3DOpacity = useRef(new Animated.Value(0)).current;

  const isDark = isDarkStyle(mapStyle);
  const mapStyleValue = getMapStyle(mapStyle);
  const has3DRoute = routeCoordinates && routeCoordinates.length > 0;

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

  // Handle 3D map bearing changes (for compass sync)
  const handleBearingChange = useCallback(
    (bearing: number) => {
      bearingAnim.setValue(-bearing);
    },
    [bearingAnim]
  );

  // Toggle map style
  const toggleStyle = useCallback(() => {
    setMapStyle((current) => getNextStyle(current));
  }, []);

  // Toggle 3D mode
  const toggle3D = useCallback(() => {
    setIs3DMode((current) => !current);
  }, []);

  // Reset orientation (bearing and pitch in 3D)
  const resetOrientation = useCallback(() => {
    if (is3DMode && is3DReady) {
      map3DRef.current?.resetOrientation();
    } else {
      cameraRef.current?.setCamera({
        heading: 0,
        animationDuration: 300,
      });
    }
    Animated.timing(bearingAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [is3DMode, is3DReady, bearingAnim, cameraRef]);

  // Handle region change for compass (real-time during gesture)
  const handleRegionIsChanging = useCallback(
    (feature: GeoJSON.Feature) => {
      const properties = feature.properties as { heading?: number } | undefined;
      if (properties?.heading !== undefined) {
        bearingAnim.setValue(-properties.heading);
      }
    },
    [bearingAnim]
  );

  // Handle region change end - track center and zoom for dynamic attribution
  const handleRegionDidChange = useCallback((feature: GeoJSON.Feature) => {
    const properties = feature.properties as
      | { zoomLevel?: number; visibleBounds?: [[number, number], [number, number]] }
      | undefined;
    const { zoomLevel, visibleBounds } = properties ?? {};

    if (zoomLevel !== undefined) {
      setCurrentZoom(zoomLevel);
    }

    // v10: center is from feature.geometry.coordinates [lng, lat]
    if (feature.geometry?.type === 'Point') {
      setCurrentCenter(feature.geometry.coordinates as [number, number]);
    } else if (visibleBounds) {
      const [[swLng, swLat], [neLng, neLat]] = visibleBounds;
      const centerLng = (swLng + neLng) / 2;
      const centerLat = (swLat + neLat) / 2;
      setCurrentCenter([centerLng, centerLat]);
    }
  }, []);

  // Get user location and refocus camera
  const handleGetLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords: [number, number] = [location.coords.longitude, location.coords.latitude];

      cameraRef.current?.setCamera({
        centerCoordinate: coords,
        zoomLevel: 14,
        animationDuration: 500,
      });
    } catch {
      // Silently fail - location is optional
    }
  }, [cameraRef]);

  // Build route GeoJSON
  // GeoJSON LineString requires minimum 2 coordinates - invalid data causes iOS crash:
  // -[__NSArrayM insertObject:atIndex:]: object cannot be nil (MLRNMapView.m:207)
  // CRITICAL: Always return valid GeoJSON to avoid iOS MapLibre crash during view reconciliation
  const routeGeoJSON = useMemo((): GeoJSON.FeatureCollection | GeoJSON.Feature => {
    const emptyCollection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    if (!routeCoordinates || routeCoordinates.length < 2) return emptyCollection;
    // Filter out NaN/Infinity coordinates
    const validCoords = routeCoordinates.filter(
      ([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)
    );
    if (validCoords.length < 2) return emptyCollection;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: validCoords,
      },
    };
  }, [routeCoordinates]);

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
        <View style={[styles.attribution, { bottom: insets.bottom }]}>
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
        <MapView
          key={`map-${mapKey}`}
          style={styles.map}
          mapStyle={mapStyleValue}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          onPress={onPress ? () => onPress({} as GeoJSON.Feature) : undefined}
          onRegionIsChanging={handleRegionIsChanging}
          onRegionDidChange={handleRegionDidChange}
          onDidFailLoadingMap={handleMapLoadError}
        >
          <Camera
            ref={cameraRef}
            defaultSettings={
              bounds ? { bounds: { ne: bounds.ne, sw: bounds.sw }, padding } : undefined
            }
          />

          {/* Route line - CRITICAL: Always render to avoid iOS crash */}
          <ShapeSource id="routeSource" shape={routeGeoJSON}>
            <LineLayer
              id="routeLine"
              style={{
                lineColor: routeColor,
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>

          {/* Custom children (markers, etc.) - filter null to prevent iOS crash */}
          {/* iOS crash: -[__NSArrayM insertObject:atIndex:]: object cannot be nil (MLRNMapView.m:207) */}
          {React.Children.toArray(children).filter(Boolean)}
        </MapView>
      </View>

      {/* 3D Map - rendered when 3D mode is on, fades in when ready */}
      {is3DMode && has3DRoute && (
        <Animated.View style={[styles.mapLayer, styles.map3DLayer, { opacity: map3DOpacity }]}>
          <Map3DWebView
            ref={map3DRef}
            coordinates={routeCoordinates}
            mapStyle={mapStyle}
            routeColor={routeColor}
            onMapReady={handleMap3DReady}
            onBearingChange={handleBearingChange}
          />
        </Animated.View>
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
    ...StyleSheet.absoluteFillObject,
  },
  map3DLayer: {
    zIndex: 1,
  },
  hiddenLayer: {
    opacity: 0,
    pointerEvents: 'none',
  },
  map: {
    flex: 1,
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
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: 4,
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
