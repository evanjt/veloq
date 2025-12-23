import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  useColorScheme,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { MapView, Camera, MarkerView, ShapeSource, LineLayer, CircleLayer } from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { colors, darkColors } from '@/theme';
import { intervalsApi } from '@/api';
import { formatDistance, formatDuration, convertLatLngTuples, normalizeBounds, getBoundsCenter } from '@/lib';
import { getActivityTypeConfig } from './ActivityTypeFilter';
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
import type { ActivityBoundsItem, ActivityMapData } from '@/types';

interface RegionalMapViewProps {
  /** Activities to display */
  activities: ActivityBoundsItem[];
  /** Callback to go back */
  onClose: () => void;
}

interface SelectedActivity {
  activity: ActivityBoundsItem;
  mapData: ActivityMapData | null;
  isLoading: boolean;
}

export function RegionalMapView({ activities, onClose }: RegionalMapViewProps) {
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const systemStyle: MapStyleType = colorScheme === 'dark' ? 'dark' : 'light';
  const [mapStyle, setMapStyle] = useState<MapStyleType>(systemStyle);
  const [selected, setSelected] = useState<SelectedActivity | null>(null);
  const [is3DMode, setIs3DMode] = useState(false);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const cameraRef = useRef<React.ElementRef<typeof Camera>>(null);
  const mapRef = useRef<React.ElementRef<typeof MapView>>(null);
  const map3DRef = useRef<Map3DWebViewRef>(null);
  const bearingAnim = useRef(new Animated.Value(0)).current;
  const initialBoundsRef = useRef<{ ne: [number, number]; sw: [number, number] } | null>(null);
  const userLocationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ===========================================
  // GESTURE TRACKING - For compass updates
  // ===========================================
  // Note: Touch interception is NO LONGER AN ISSUE because we use native CircleLayer
  // instead of React Pressable. CircleLayer doesn't capture touches - it only responds
  // to taps AFTER the map's gesture system has processed them.
  const currentZoomLevel = useRef(10); // Track current zoom for compass updates

  const isDark = isDarkStyle(mapStyle);
  const mapStyleValue = getMapStyle(mapStyle);
  const attributionText = is3DMode
    ? `${MAP_ATTRIBUTIONS[mapStyle]} | ${TERRAIN_ATTRIBUTION}`
    : MAP_ATTRIBUTIONS[mapStyle];

  // Calculate bounds from activities (used for initial camera position)
  // Uses normalizeBounds to auto-detect coordinate format from API
  const calculateBounds = useCallback((activityList: ActivityBoundsItem[]) => {
    if (activityList.length === 0) return null;

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    for (const activity of activityList) {
      const normalized = normalizeBounds(activity.bounds);
      minLat = Math.min(minLat, normalized.minLat);
      maxLat = Math.max(maxLat, normalized.maxLat);
      minLng = Math.min(minLng, normalized.minLng);
      maxLng = Math.max(maxLng, normalized.maxLng);
    }

    return {
      ne: [maxLng, maxLat] as [number, number],
      sw: [minLng, minLat] as [number, number],
    };
  }, []);

  // Set initial bounds only once when we first have activities
  // This prevents the map from jumping around during background sync
  useEffect(() => {
    if (initialBoundsRef.current === null && activities.length > 0) {
      initialBoundsRef.current = calculateBounds(activities);
    }
  }, [activities, calculateBounds]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (userLocationTimeoutRef.current) {
        clearTimeout(userLocationTimeoutRef.current);
      }
    };
  }, []);

  // Note: Container touch handlers and interaction timeout cleanup removed
  // Using native CircleLayer which doesn't intercept touches

  // Use the stored initial bounds for the camera default
  const mapBounds = initialBoundsRef.current || calculateBounds(activities);

  // Handle marker tap - no auto-zoom to prevent jarring camera movements
  const handleMarkerTap = useCallback(async (activity: ActivityBoundsItem) => {
    // Set loading state - don't zoom, just show the popup
    setSelected({ activity, mapData: null, isLoading: true });

    try {
      // Fetch full map data (with coordinates)
      const mapData = await intervalsApi.getActivityMap(activity.id, false);
      setSelected({ activity, mapData, isLoading: false });
    } catch {
      setSelected({ activity, mapData: null, isLoading: false });
    }
  }, []);

  // Close popup
  const handleClosePopup = useCallback(() => {
    setSelected(null);
  }, []);

  // Navigate to activity detail
  const handleViewDetails = useCallback(() => {
    if (selected) {
      router.push(`/activity/${selected.activity.id}`);
      setSelected(null);
    }
  }, [selected, router]);

  // Zoom to selected activity bounds
  const handleZoomToActivity = useCallback(() => {
    if (!selected) return;

    const normalized = normalizeBounds(selected.activity.bounds);
    const bounds = {
      ne: [normalized.maxLng, normalized.maxLat] as [number, number],
      sw: [normalized.minLng, normalized.minLat] as [number, number],
    };

    cameraRef.current?.setCamera({
      bounds,
      padding: { paddingTop: 100, paddingRight: 60, paddingBottom: 280, paddingLeft: 60 },
      animationDuration: 500,
    });
  }, [selected]);

  // Toggle map style (cycles through light → dark → satellite)
  const toggleStyle = () => {
    setMapStyle(current => getNextStyle(current));
  };

  // Toggle 3D mode
  const toggle3D = () => {
    setIs3DMode(current => !current);
  };

  // Reset bearing to north (and pitch in 3D mode)
  const resetOrientation = () => {
    if (is3DMode) {
      // In 3D mode, reset bearing and pitch via WebView
      map3DRef.current?.resetOrientation();
    } else {
      cameraRef.current?.setCamera({
        heading: 0,
        animationDuration: 300,
      });
    }
    // Animate the compass back to 0
    Animated.timing(bearingAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  // Handle map region change to update compass (real-time during gesture)
  const handleRegionIsChanging = useCallback((feature: GeoJSON.Feature) => {
    const properties = feature.properties as { heading?: number; zoomLevel?: number } | undefined;
    if (properties?.heading !== undefined) {
      // Update animated value directly - no re-render
      bearingAnim.setValue(-properties.heading);
    }
    // Track zoom level for dynamic threshold calculation
    if (properties?.zoomLevel !== undefined) {
      currentZoomLevel.current = properties.zoomLevel;
    }
  }, [bearingAnim]);

  // Handle region change end - track zoom level for any features that need it
  const handleRegionDidChange = useCallback((feature: GeoJSON.Feature) => {
    const properties = feature.properties as { zoomLevel?: number } | undefined;
    if (properties?.zoomLevel !== undefined) {
      currentZoomLevel.current = properties.zoomLevel;
    }
  }, []);

  // Get user location (one-time jump, no tracking)
  const handleGetLocation = useCallback(async () => {
    try {
      // Request permission
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return;
      }

      // Get current location
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords: [number, number] = [location.coords.longitude, location.coords.latitude];

      // Show marker briefly then remove
      setUserLocation(coords);

      // Zoom to user location
      cameraRef.current?.setCamera({
        centerCoordinate: coords,
        zoomLevel: 13,
        animationDuration: 500,
      });

      // Clear any existing timeout
      if (userLocationTimeoutRef.current) {
        clearTimeout(userLocationTimeoutRef.current);
      }

      // Clear the marker after a few seconds (one-time location, not tracking)
      userLocationTimeoutRef.current = setTimeout(() => setUserLocation(null), 3000);
    } catch {
      // Silently fail - location is optional
    }
  }, []);

  // Calculate marker size based on distance
  const getMarkerSize = (distance: number): number => {
    if (distance < 5000) return 20; // < 5km
    if (distance < 15000) return 24; // 5-15km
    if (distance < 30000) return 28; // 15-30km
    return 32; // > 30km
  };

  // Get center of bounds - uses getBoundsCenter which auto-detects format
  // Returns [longitude, latitude] for MapLibre
  const getCenter = (bounds: [[number, number], [number, number]]): [number, number] => {
    return getBoundsCenter(bounds);
  };

  // ===========================================
  // NATIVE MARKER RENDERING - Uses CircleLayer instead of React components
  // ===========================================
  // This completely avoids touch interception issues with Pressable
  // Markers are rendered as native map features, preserving all gestures

  // Build GeoJSON feature collection for activity markers
  const markersGeoJSON = useMemo(() => {
    const features = activities.map((activity) => {
      const center = getCenter(activity.bounds);
      const config = getActivityTypeConfig(activity.type);
      const size = getMarkerSize(activity.distance);

      return {
        type: 'Feature' as const,
        id: activity.id,
        properties: {
          id: activity.id,
          type: activity.type,
          color: config.color,
          size: size,
          isSelected: selected?.activity.id === activity.id,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: center,
        },
      };
    });

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [activities, selected?.activity.id]);

  // Handle marker tap via ShapeSource press - NO touch interception!
  const handleMarkerPress = useCallback((event: { features?: GeoJSON.Feature[] }) => {
    const feature = event.features?.[0];
    if (!feature?.properties?.id) return;

    const activityId = feature.properties.id;
    const activity = activities.find(a => a.id === activityId);
    if (activity) {
      handleMarkerTap(activity);
    }
  }, [activities, handleMarkerTap]);

  // Handle map press - close popup when tapping empty space
  const handleMapPress = useCallback(() => {
    // Close popup when tapping empty space
    if (selected) {
      setSelected(null);
    }
  }, [selected]);

  // Build route GeoJSON for selected activity
  // Uses the same coordinate conversion as ActivityMapView for consistency
  const routeGeoJSON = useMemo(() => {
    if (!selected?.mapData?.latlngs) return null;

    // Filter out null values first
    const nonNullCoords = selected.mapData.latlngs.filter(
      (c): c is [number, number] => c !== null
    );

    if (nonNullCoords.length === 0) return null;

    // Convert to LatLng objects using the same function as ActivityMapView
    const latLngCoords = convertLatLngTuples(nonNullCoords);

    // Filter valid coordinates and convert to GeoJSON format [lng, lat]
    const validCoords = latLngCoords
      .filter(c => !isNaN(c.latitude) && !isNaN(c.longitude))
      .map(c => [c.longitude, c.latitude]);

    if (validCoords.length === 0) return null;

    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: validCoords,
      },
    };
  }, [selected?.mapData]);

  // Get 3D route coordinates from selected activity
  const route3DCoords = useMemo(() => {
    if (!selected?.mapData?.latlngs) return [];

    return selected.mapData.latlngs
      .filter((c): c is [number, number] => c !== null)
      .map(([lat, lng]) => [lng, lat] as [number, number]); // Convert to [lng, lat]
  }, [selected?.mapData]);

  // 3D is available when we have route data to display
  const can3D = selected && route3DCoords.length > 0;
  // Show 3D view when enabled and we have route data
  const show3D = is3DMode && can3D;

  return (
    <View style={styles.container}>
      {show3D ? (
        <Map3DWebView
          ref={map3DRef}
          coordinates={route3DCoords}
          mapStyle={mapStyle}
          routeColor={getActivityTypeConfig(selected.activity.type).color}
        />
      ) : (
      <MapView
        ref={mapRef}
        style={styles.map}
        mapStyle={mapStyleValue}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        onPress={handleMapPress}
        onRegionIsChanging={handleRegionIsChanging}
        onRegionDidChange={handleRegionDidChange}
      >
        {/* Camera with ref for programmatic control */}
        <Camera
          ref={cameraRef}
          defaultSettings={{
            bounds: mapBounds ?? undefined,
            padding: { paddingTop: 100, paddingRight: 40, paddingBottom: 200, paddingLeft: 40 },
          }}
          animationDuration={0}
        />

        {/* Invisible ShapeSource for tap detection only - no visual rendering */}
        {/* This handles taps without intercepting gestures */}
        <ShapeSource
          id="activity-markers"
          shape={markersGeoJSON}
          onPress={handleMarkerPress}
          hitbox={{ width: 44, height: 44 }}
        >
          {/* Invisible circles just for hit detection */}
          <CircleLayer
            id="marker-hitarea"
            style={{
              circleRadius: ['/', ['get', 'size'], 2],
              circleColor: 'transparent',
              circleStrokeWidth: 0,
            }}
          />
        </ShapeSource>

        {/* Activity markers - visual only, rendered as MarkerView for correct z-ordering */}
        {/* pointerEvents="none" ensures these don't intercept any touches */}
        {/* Sorted to render selected activity last (on top) */}
        {[...activities]
          .sort((a, b) => {
            // Selected marker renders last (on top)
            if (selected?.activity.id === a.id) return 1;
            if (selected?.activity.id === b.id) return -1;
            return 0;
          })
          .map((activity) => {
          const config = getActivityTypeConfig(activity.type);
          const center = getCenter(activity.bounds);
          const size = getMarkerSize(activity.distance);
          const isSelected = selected?.activity.id === activity.id;
          const markerSize = isSelected ? size + 8 : size;
          // Larger icon ratio to fill more of the marker
          const iconSize = isSelected ? size * 0.75 : size * 0.7;

          return (
            <MarkerView
              key={`marker-${activity.id}`}
              coordinate={center}
              anchor={{ x: 0.5, y: 0.5 }}
              allowOverlap={true}
            >
              {/* Single view with fixed dimensions - no flex/dynamic sizing */}
              <View
                pointerEvents="none"
                style={{
                  width: markerSize,
                  height: markerSize,
                  borderRadius: markerSize / 2,
                  backgroundColor: config.color,
                  // Thinner border to give more space for the icon
                  borderWidth: isSelected ? 2 : 1.5,
                  borderColor: isSelected ? colors.primary : '#FFFFFF',
                  justifyContent: 'center',
                  alignItems: 'center',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.3,
                  shadowRadius: 3,
                  elevation: 4,
                }}
              >
                <Ionicons
                  name={config.icon}
                  size={iconSize}
                  color="#FFFFFF"
                />
              </View>
            </MarkerView>
          );
        })}

        {/* Selected activity route */}
        {/* Key forces re-render when activity changes to ensure proper positioning */}
        {routeGeoJSON && selected && (
          <ShapeSource
            key={`route-${selected.activity.id}`}
            id={`route-${selected.activity.id}`}
            shape={routeGeoJSON}
          >
            <LineLayer
              id={`routeLine-${selected.activity.id}`}
              style={{
                lineColor: getActivityTypeConfig(selected.activity.type).color,
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        )}

        {/* User location marker */}
        {userLocation && (
          <MarkerView
            coordinate={userLocation}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.userLocationMarker}>
              <View style={styles.userLocationDot} />
            </View>
          </MarkerView>
        )}
      </MapView>
      )}

      {/* Close button */}
      <TouchableOpacity
        style={[styles.button, styles.closeButton, { top: insets.top + 12 }, isDark && styles.buttonDark]}
        onPress={onClose}
        activeOpacity={0.8}
        accessibilityLabel="Close map"
        accessibilityRole="button"
      >
        <MaterialCommunityIcons
          name="close"
          size={24}
          color={isDark ? '#FFFFFF' : '#333333'}
        />
      </TouchableOpacity>

      {/* Style toggle */}
      <TouchableOpacity
        style={[styles.button, styles.styleButton, { top: insets.top + 12 }, isDark && styles.buttonDark]}
        onPress={toggleStyle}
        activeOpacity={0.8}
        accessibilityLabel="Toggle map style"
        accessibilityRole="button"
      >
        <MaterialCommunityIcons
          name={getStyleIcon(mapStyle)}
          size={24}
          color={isDark ? '#FFFFFF' : '#333333'}
        />
      </TouchableOpacity>

      {/* Control button stack - positioned in middle of right side */}
      <View style={[styles.controlStack, { top: insets.top + 64 }]}>
        {/* 3D Toggle - only active when activity with route is selected */}
        <TouchableOpacity
          style={[
            styles.controlButton,
            isDark && styles.controlButtonDark,
            show3D && styles.controlButtonActive,
            !can3D && styles.controlButtonDisabled,
          ]}
          onPress={can3D ? toggle3D : undefined}
          activeOpacity={can3D ? 0.8 : 1}
          disabled={!can3D}
          accessibilityLabel={show3D ? 'Disable 3D view' : 'Enable 3D view'}
          accessibilityRole="button"
          accessibilityState={{ disabled: !can3D }}
        >
          <MaterialCommunityIcons
            name="terrain"
            size={22}
            color={show3D ? '#FFFFFF' : (can3D ? (isDark ? '#FFFFFF' : '#333333') : (isDark ? '#666666' : '#AAAAAA'))}
          />
        </TouchableOpacity>

        {/* North Arrow - tap to reset orientation */}
        <TouchableOpacity
          style={[styles.controlButton, isDark && styles.controlButtonDark]}
          onPress={resetOrientation}
          activeOpacity={0.8}
          accessibilityLabel="Reset map orientation"
          accessibilityRole="button"
        >
          <CompassArrow
            size={22}
            rotation={bearingAnim}
            northColor="#E53935"
            southColor={isDark ? '#FFFFFF' : '#333333'}
          />
        </TouchableOpacity>

        {/* Location button */}
        <TouchableOpacity
          style={[
            styles.controlButton,
            isDark && styles.controlButtonDark,
            userLocation && styles.controlButtonActive,
          ]}
          onPress={handleGetLocation}
          activeOpacity={0.8}
          accessibilityLabel="Go to my location"
          accessibilityRole="button"
        >
          <MaterialCommunityIcons
            name="crosshairs-gps"
            size={22}
            color={userLocation ? '#FFFFFF' : (isDark ? '#FFFFFF' : '#333333')}
          />
        </TouchableOpacity>
      </View>

      {/* Attribution */}
      <View style={[styles.attribution, { bottom: insets.bottom + 8 }]}>
        <Text style={styles.attributionText}>{attributionText}</Text>
      </View>

      {/* Selected activity popup - positioned above the timeline slider */}
      {selected && (
        <View style={[styles.popup, { bottom: insets.bottom + 200 }]}>
          <View style={styles.popupHeader}>
            <View style={styles.popupInfo}>
              <Text style={styles.popupTitle} numberOfLines={1}>
                {selected.activity.name}
              </Text>
              <Text style={styles.popupDate}>
                {new Date(selected.activity.date).toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </Text>
            </View>
            <View style={styles.popupHeaderButtons}>
              <TouchableOpacity
                onPress={handleZoomToActivity}
                style={styles.popupIconButton}
                accessibilityLabel="Zoom to activity"
                accessibilityRole="button"
              >
                <MaterialCommunityIcons name="crosshairs-gps" size={22} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleClosePopup}
                style={styles.popupIconButton}
                accessibilityLabel="Close activity popup"
                accessibilityRole="button"
              >
                <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.popupStats}>
            <View style={styles.popupStat}>
              <Ionicons name={getActivityTypeConfig(selected.activity.type).icon} size={20} color={getActivityTypeConfig(selected.activity.type).color} />
              <Text style={styles.popupStatValue}>{selected.activity.type}</Text>
            </View>
            <View style={styles.popupStat}>
              <MaterialCommunityIcons name="map-marker-distance" size={20} color={colors.chartBlue} />
              <Text style={styles.popupStatValue}>{formatDistance(selected.activity.distance)}</Text>
            </View>
            <View style={styles.popupStat}>
              <MaterialCommunityIcons name="clock-outline" size={20} color={colors.chartOrange} />
              <Text style={styles.popupStatValue}>{formatDuration(selected.activity.duration)}</Text>
            </View>
          </View>

          {selected.isLoading && (
            <View style={styles.popupLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.popupLoadingText}>Loading route...</Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.viewDetailsButton}
            onPress={handleViewDetails}
          >
            <Text style={styles.viewDetailsText}>View Details</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
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
  controlButtonDisabled: {
    opacity: 0.5,
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
  markerWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    justifyContent: 'center',
    alignItems: 'center',
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  markerSelected: {
    borderWidth: 3,
    borderColor: colors.primary,
    // Don't use scale transform - it causes clipping in MarkerView
  },
  popup: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  popupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  popupHeaderButtons: {
    flexDirection: 'row',
    gap: 4,
  },
  popupIconButton: {
    padding: 4,
  },
  popupInfo: {
    flex: 1,
    marginRight: 8,
  },
  popupTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  popupDate: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  popupStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    marginBottom: 12,
  },
  popupStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  popupStatValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  popupLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  popupLoadingText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  viewDetailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  viewDetailsText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  attribution: {
    position: 'absolute',
    right: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  attributionText: {
    fontSize: 9,
    color: '#333333',
  },
});
