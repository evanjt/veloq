import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  useColorScheme,
  TouchableOpacity,
  Pressable,
  Modal,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { MapView, Camera, MarkerView, ShapeSource, LineLayer } from '@maplibre/maplibre-react-native';
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
  const gestureInProgress = useRef(false);
  const lastTouchCount = useRef(0);
  const initialBoundsRef = useRef<{ ne: [number, number]; sw: [number, number] } | null>(null);

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

  // Use the stored initial bounds for the camera default
  const mapBounds = initialBoundsRef.current || calculateBounds(activities);

  // Handle marker tap
  const handleMarkerTap = useCallback(async (activity: ActivityBoundsItem) => {
    // Set loading state
    setSelected({ activity, mapData: null, isLoading: true });

    // Zoom to the selected activity's bounds
    const normalized = normalizeBounds(activity.bounds);
    cameraRef.current?.fitBounds(
      [normalized.minLng, normalized.minLat],
      [normalized.maxLng, normalized.maxLat],
      50, // padding
      300 // animation duration
    );

    try {
      // Fetch full map data (with coordinates)
      const mapData = await intervalsApi.getActivityMap(activity.id, false);
      setSelected({ activity, mapData, isLoading: false });
    } catch (error) {
      console.error('Failed to load activity route:', error);
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
    const properties = feature.properties as { heading?: number } | undefined;
    if (properties?.heading !== undefined) {
      // Update animated value directly - no re-render
      bearingAnim.setValue(-properties.heading);
    }
  }, [bearingAnim]);

  // Get user location (one-time jump, no tracking)
  const handleGetLocation = useCallback(async () => {
    try {
      // Request permission
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.warn('Location permission denied');
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

      // Clear the marker after a few seconds (one-time location, not tracking)
      setTimeout(() => setUserLocation(null), 3000);
    } catch (error) {
      console.error('Failed to get location:', error);
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

  // Handle map press - find nearest marker or close popup
  const handleMapPress = useCallback((event: any) => {
    const { geometry } = event;
    if (!geometry?.coordinates) return;

    const [tapLng, tapLat] = geometry.coordinates;

    // Find the nearest activity marker
    let nearestActivity: ActivityBoundsItem | null = null;
    let minDistance = Infinity;

    for (const activity of activities) {
      const center = getCenter(activity.bounds);
      const [markerLng, markerLat] = center;

      // Simple distance calculation (good enough for nearby points)
      const distance = Math.sqrt(
        Math.pow(tapLat - markerLat, 2) + Math.pow(tapLng - markerLng, 2)
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestActivity = activity;
      }
    }

    // Threshold for "close enough" - about 0.02 degrees
    if (nearestActivity && minDistance < 0.02) {
      handleMarkerTap(nearestActivity);
    } else if (selected) {
      // Tapped on empty space - close popup
      setSelected(null);
    }
  }, [activities, handleMarkerTap, selected]);

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

  // Show 3D view when enabled and we have route data
  const show3D = is3DMode && selected && route3DCoords.length > 0;

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
        scaleBarEnabled={false}
        onPress={handleMapPress}
        onRegionIsChanging={handleRegionIsChanging}
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

        {/* Activity markers - render selected one last so it's on top */}
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

          return (
            <MarkerView
              key={activity.id}
              coordinate={center}
              anchor={{ x: 0.5, y: 0.5 }}
              allowOverlap={true}
            >
              <Pressable
                onPressIn={() => {
                  // Mark that a press started - we'll check on release if it was valid
                  gestureInProgress.current = false;
                  lastTouchCount.current = 1;
                }}
                onPressOut={() => {
                  // Only trigger if it was a clean single tap (no multi-touch detected)
                  if (!gestureInProgress.current && lastTouchCount.current === 1) {
                    handleMarkerTap(activity);
                  }
                  // Reset
                  gestureInProgress.current = false;
                  lastTouchCount.current = 0;
                }}
                onTouchMove={(e) => {
                  // If multiple touches detected during move, mark as gesture
                  if (e.nativeEvent.touches && e.nativeEvent.touches.length > 1) {
                    gestureInProgress.current = true;
                    lastTouchCount.current = e.nativeEvent.touches.length;
                  }
                }}
                // Smaller hitSlop for selected marker to allow tapping nearby markers
                hitSlop={isSelected ? { top: 5, bottom: 5, left: 5, right: 5 } : { top: 15, bottom: 15, left: 15, right: 15 }}
                style={({ pressed }) => [
                  {
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.marker,
                    {
                      // Selected markers are slightly larger
                      width: isSelected ? size + 8 : size,
                      height: isSelected ? size + 8 : size,
                      borderRadius: (isSelected ? size + 8 : size) / 2,
                      backgroundColor: config.color,
                    },
                    isSelected && styles.markerSelected,
                  ]}
                >
                  <Ionicons
                    name={config.icon}
                    size={isSelected ? size * 0.55 : size * 0.5}
                    color="#FFFFFF"
                  />
                </View>
              </Pressable>
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
      >
        <MaterialCommunityIcons
          name={getStyleIcon(mapStyle)}
          size={24}
          color={isDark ? '#FFFFFF' : '#333333'}
        />
      </TouchableOpacity>

      {/* Control button stack - positioned in middle of right side */}
      <View style={[styles.controlStack, { top: insets.top + 140 }]}>
        {/* 3D Toggle */}
        <TouchableOpacity
          style={[
            styles.controlButton,
            isDark && styles.controlButtonDark,
            is3DMode && styles.controlButtonActive,
          ]}
          onPress={toggle3D}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons
            name="terrain"
            size={22}
            color={is3DMode ? '#FFFFFF' : (isDark ? '#FFFFFF' : '#333333')}
          />
        </TouchableOpacity>

        {/* North Arrow - tap to reset orientation */}
        <TouchableOpacity
          style={[styles.controlButton, isDark && styles.controlButtonDark]}
          onPress={resetOrientation}
          activeOpacity={0.8}
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
        >
          <MaterialCommunityIcons
            name="crosshairs-gps"
            size={22}
            color={userLocation ? '#FFFFFF' : (isDark ? '#FFFFFF' : '#333333')}
          />
        </TouchableOpacity>
      </View>

      {/* Activity count badge */}
      <View style={[styles.countBadge, isDark && styles.countBadgeDark]}>
        <Text style={[styles.countText, isDark && styles.countTextDark]}>
          {activities.length} activities
        </Text>
      </View>

      {/* Attribution */}
      <View style={[styles.attribution, { bottom: insets.bottom + 8 }]}>
        <Text style={styles.attributionText}>{attributionText}</Text>
      </View>

      {/* Selected activity popup - positioned above the timeline slider */}
      {selected && (
        <View style={[styles.popup, { bottom: insets.bottom + 160 }]}>
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
            <TouchableOpacity onPress={handleClosePopup}>
              <MaterialCommunityIcons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
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
  countBadge: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  countBadgeDark: {
    backgroundColor: 'rgba(50, 50, 50, 0.95)',
  },
  countText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  countTextDark: {
    color: '#FFFFFF',
  },
  marker: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
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
  popupInfo: {
    flex: 1,
    marginRight: 12,
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
