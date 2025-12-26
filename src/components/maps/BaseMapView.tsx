import React, { useState, useCallback, useRef, useMemo, ReactNode, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  useColorScheme,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { MapView, Camera, ShapeSource, LineLayer, MarkerView } from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
} from './mapStyles';

export interface BaseMapViewProps {
  /** Route coordinates as [lng, lat] pairs for GeoJSON */
  routeCoordinates?: [number, number][];
  /** Route line color */
  routeColor?: string;
  /** Bounds to fit camera to */
  bounds?: { ne: [number, number]; sw: [number, number] };
  /** Camera padding */
  padding?: { paddingTop: number; paddingRight: number; paddingBottom: number; paddingLeft: number };
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
  setCamera: (options: { centerCoordinate?: [number, number]; zoomLevel?: number; heading?: number; animationDuration?: number }) => void;
  fitBounds: (ne: [number, number], sw: [number, number], padding?: number, duration?: number) => void;
}

export function BaseMapView({
  routeCoordinates,
  routeColor = colors.primary,
  bounds,
  padding = { paddingTop: 80, paddingRight: 40, paddingBottom: 40, paddingLeft: 40 },
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
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const systemStyle: MapStyleType = colorScheme === 'dark' ? 'dark' : 'light';

  const [mapStyle, setMapStyle] = useState<MapStyleType>(initialStyle ?? systemStyle);
  const [is3DMode, setIs3DMode] = useState(false);
  const [is3DReady, setIs3DReady] = useState(false);

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
  const handleBearingChange = useCallback((bearing: number) => {
    bearingAnim.setValue(-bearing);
  }, [bearingAnim]);

  // Toggle map style
  const toggleStyle = useCallback(() => {
    setMapStyle(current => getNextStyle(current));
  }, []);

  // Toggle 3D mode
  const toggle3D = useCallback(() => {
    setIs3DMode(current => !current);
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
  const handleRegionIsChanging = useCallback((feature: GeoJSON.Feature) => {
    const properties = feature.properties as { heading?: number } | undefined;
    if (properties?.heading !== undefined) {
      bearingAnim.setValue(-properties.heading);
    }
  }, [bearingAnim]);

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
  const routeGeoJSON = useMemo(() => {
    if (!routeCoordinates || routeCoordinates.length === 0) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: routeCoordinates,
      },
    };
  }, [routeCoordinates]);

  // Get attribution text
  const attributionText = is3DMode
    ? `${MAP_ATTRIBUTIONS[mapStyle]} | ${TERRAIN_ATTRIBUTION}`
    : MAP_ATTRIBUTIONS[mapStyle];

  // Render controls (shared between 2D and 3D)
  const renderControls = () => (
    <>
      {/* Close button */}
      {onClose && (
        <TouchableOpacity
          style={[styles.button, styles.closeButton, { top: insets.top + 12 }, isDark && styles.buttonDark]}
          onPress={onClose}
          activeOpacity={0.8}
          accessibilityLabel="Close map"
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="close" size={24} color={isDark ? colors.textOnDark : colors.textSecondary} />
        </TouchableOpacity>
      )}

      {/* Style toggle */}
      {showStyleToggle && (
        <TouchableOpacity
          style={[styles.button, styles.styleButton, { top: insets.top + 12 }, isDark && styles.buttonDark]}
          onPress={toggleStyle}
          activeOpacity={0.8}
          accessibilityLabel="Toggle map style"
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name={getStyleIcon(mapStyle)} size={24} color={isDark ? colors.textOnDark : colors.textSecondary} />
        </TouchableOpacity>
      )}

      {/* Control stack - positioned just below the style toggle button */}
      <View style={[styles.controlStack, { top: insets.top + 64 }]}>
        {show3DToggle && has3DRoute && (
          <TouchableOpacity
            style={[styles.controlButton, isDark && styles.controlButtonDark, is3DMode && styles.controlButtonActive]}
            onPress={toggle3D}
            activeOpacity={0.8}
            accessibilityLabel={is3DMode ? 'Disable 3D view' : 'Enable 3D view'}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="terrain" size={22} color={is3DMode ? colors.textOnDark : (isDark ? colors.textOnDark : colors.textSecondary)} />
          </TouchableOpacity>
        )}

        {showOrientationButton && (
          <TouchableOpacity
            style={[styles.controlButton, isDark && styles.controlButtonDark]}
            onPress={resetOrientation}
            activeOpacity={0.8}
            accessibilityLabel="Reset map orientation"
            accessibilityRole="button"
          >
            <CompassArrow size={22} rotation={bearingAnim} northColor={colors.error} southColor={isDark ? colors.textOnDark : colors.textSecondary} />
          </TouchableOpacity>
        )}

        {showLocationButton && (
          <TouchableOpacity
            style={[styles.controlButton, isDark && styles.controlButtonDark]}
            onPress={handleGetLocation}
            activeOpacity={0.8}
            accessibilityLabel="Go to my location"
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
        <View style={[styles.attribution, { bottom: insets.bottom + 8 }]}>
          <Text style={styles.attributionText}>{attributionText}</Text>
        </View>
      )}
    </>
  );

  return (
    <View style={styles.container}>
      {/* 2D Map - always rendered, hidden when 3D is ready */}
      <View style={[styles.mapLayer, (is3DMode && is3DReady) && styles.hiddenLayer]}>
        <MapView
          style={styles.map}
          mapStyle={mapStyleValue}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          onPress={onPress}
          onRegionIsChanging={handleRegionIsChanging}
        >
          <Camera
            ref={cameraRef}
            defaultSettings={bounds ? { bounds, padding } : undefined}
            animationDuration={0}
          />

          {/* Route line */}
          {routeGeoJSON && (
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
          )}

          {/* Custom children (markers, etc.) */}
          {children}
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
    right: spacing.md,
    gap: spacing.sm,
    zIndex: 10,
  },
  controlButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
    right: spacing.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: spacing.xs,
    zIndex: 10,
  },
  attributionText: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
  },
});
