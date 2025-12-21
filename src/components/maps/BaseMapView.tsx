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
import { colors } from '@/theme';
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
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);

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

  // Get user location (one-time jump)
  const handleGetLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords: [number, number] = [location.coords.longitude, location.coords.latitude];
      setUserLocation(coords);

      cameraRef.current?.setCamera({
        centerCoordinate: coords,
        zoomLevel: 14,
        animationDuration: 500,
      });

      setTimeout(() => setUserLocation(null), 3000);
    } catch (error) {
      console.error('Failed to get location:', error);
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
        >
          <MaterialCommunityIcons name="close" size={24} color={isDark ? '#FFFFFF' : '#333333'} />
        </TouchableOpacity>
      )}

      {/* Style toggle */}
      {showStyleToggle && (
        <TouchableOpacity
          style={[styles.button, styles.styleButton, { top: insets.top + 12 }, isDark && styles.buttonDark]}
          onPress={toggleStyle}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name={getStyleIcon(mapStyle)} size={24} color={isDark ? '#FFFFFF' : '#333333'} />
        </TouchableOpacity>
      )}

      {/* Control stack */}
      <View style={[styles.controlStack, { top: insets.top + 140 }]}>
        {show3DToggle && has3DRoute && (
          <TouchableOpacity
            style={[styles.controlButton, isDark && styles.controlButtonDark, is3DMode && styles.controlButtonActive]}
            onPress={toggle3D}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="terrain" size={22} color={is3DMode ? '#FFFFFF' : (isDark ? '#FFFFFF' : '#333333')} />
          </TouchableOpacity>
        )}

        {showOrientationButton && (
          <TouchableOpacity
            style={[styles.controlButton, isDark && styles.controlButtonDark]}
            onPress={resetOrientation}
            activeOpacity={0.8}
          >
            <CompassArrow size={22} rotation={bearingAnim} northColor="#E53935" southColor={isDark ? '#FFFFFF' : '#333333'} />
          </TouchableOpacity>
        )}

        {showLocationButton && (
          <TouchableOpacity
            style={[styles.controlButton, isDark && styles.controlButtonDark, userLocation && styles.controlButtonActive]}
            onPress={handleGetLocation}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons
              name="crosshairs-gps"
              size={22}
              color={userLocation ? '#FFFFFF' : (isDark ? '#FFFFFF' : '#333333')}
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

          {/* User location marker */}
          {userLocation && (
            <MarkerView coordinate={userLocation} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.userLocationMarker}>
                <View style={styles.userLocationDot} />
              </View>
            </MarkerView>
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
    backgroundColor: '#000',
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
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
    zIndex: 10,
  },
  buttonDark: {
    backgroundColor: 'rgba(50, 50, 50, 0.95)',
  },
  closeButton: {
    left: 16,
  },
  styleButton: {
    right: 16,
  },
  controlStack: {
    position: 'absolute',
    right: 16,
    gap: 8,
    zIndex: 10,
  },
  controlButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  controlButtonDark: {
    backgroundColor: 'rgba(50, 50, 50, 0.95)',
  },
  controlButtonActive: {
    backgroundColor: colors.primary,
  },
  userLocationMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(66, 165, 245, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userLocationDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#42A5F5',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  attribution: {
    position: 'absolute',
    right: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    zIndex: 10,
  },
  attributionText: {
    fontSize: 9,
    color: '#333333',
  },
});
