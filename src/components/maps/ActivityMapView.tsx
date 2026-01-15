/**
 * @fileoverview ActivityMapView - Interactive GPS track visualization
 *
 * **Overview**
 *
 * This component renders activity GPS tracks on a map with support for multiple
 * visualization modes, style switching, and interactive features. It combines
 * MapLibre's 2D rendering with a 3D WebView overlay for terrain visualization.
 *
 * **Architecture**
 *
 * **Dual Rendering System:**
 * - 2D Map: MapLibre React Native (native performance, gesture handling)
 * - 3D Map: WebView with Mapbox GL JS (terrain visualization)
 * - Crossfading: Animated opacity transitions between modes
 *
 * **State Management:**
 * - mapStyle: Current map style (standard/satellite/terrain)
 * - userOverride: Whether user manually changed style (prevents auto-switching)
 * - is3DMode/is3DReady: 3D mode state with loading indicator
 * - creationState/startIndex/endIndex: Section creation flow
 * - highlightIndex: Elevation chart crosshair position
 *
 * **Data Flow:**
 * 1. Props (polyline/coordinates) → decoded → validated → rendered
 * 2. Map style preference → auto-applied (unless user override)
 * 3. Section creation → start → end → callback with result
 * 4. Highlight index → marker → camera follow (optional)
 *
 * **Key Features:**
 *
 * **Style Switching:**
 * - Cycles: standard → satellite → terrain → standard
 * - Respects user preferences from MapPreferencesContext
 * - Manual override persists until component remounts
 *
 * **Section Creation:**
 * - Two-tap interaction: select start → select end → confirm
 * - Distance calculation via Haversine formula
 * - Visual feedback with marker overlays
 * - Callback with polyline slice and distance
 *
 * **Location Services:**
 * - Requests foreground permissions on demand
 * - Camera animates to user position
 * - Silently fails if permission denied
 *
 * **Performance Optimizations:**
 * - coordinate parsing memoized (expensive decodePolyline)
 * - Valid coordinates filtered once (NaN checks)
 * - 3D WebView opacity animated (native driver)
 *
 * **Trade-offs:**
 *
 * **Why WebView for 3D?**
 * - Pro: Mapbox GL JS has mature terrain visualization
 * - Pro: Faster to implement than native 3D solution
 * - Con: Additional memory footprint
 * - Con: Slower initial load
 *
 * **Why Animated.Value for 3D opacity?**
 * - Pro: Smooth crossfade (native driver)
 * - Con: Adds complexity to state management
 * - Alternative: CSS transitions (less control)
 *
 * **Why Section Creation State Machine?**
 * - Pro: Clear UX flow (start → end → confirm)
 * - Pro: Prevents invalid states
 * - Con: More complex than simple boolean
 *
 * **Component Size Note:**
 * At 861 lines, this component handles multiple concerns. Future refactoring
 * should consider extracting:
 * - StyleSwitcher component
 * - SectionCreationFlow component
 * - LocationHandler component
 * - HighlightRenderer component
 *
 * @example
 * ```tsx
 * // Basic usage with polyline
 * <ActivityMapView
 *   polyline={activity.map.polyline}
 *   activityType={activity.type}
 *   height={400}
 * />
 *
 * // With section creation
 * <ActivityMapView
 *   polyline={activity.map.polyline}
 *   activityType={activity.type}
 *   creationMode={isEditing}
 *   onSectionCreated={(result) => {
 *     console.log('Section:', result.distanceMeters, 'm');
 *   }}
 *   onCreationCancelled={() => {
 *     setIsEditing(false);
 *   }}
 * />
 *
 * // With elevation highlight
 * <ActivityMapView
 *   polyline={activity.map.polyline}
 *   activityType={activity.type}
 *   highlightIndex={chartPointIndex}
 * />
 * ```
 */

import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, StatusBar, Animated, Text } from 'react-native';
import {
  MapView,
  Camera,
  ShapeSource,
  LineLayer,
  MarkerView,
} from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { decodePolyline, LatLng, getActivityColor, getMapLibreBounds } from '@/lib';
import { colors, darkColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import { shadows } from '@/theme/shadows';
import { useMapPreferences } from '@/providers';
import { BaseMapView } from './BaseMapView';
import { Map3DWebView, type Map3DWebViewRef } from './Map3DWebView';
import { CompassArrow } from '@/components/ui';
import { SectionCreationOverlay, type CreationState } from './SectionCreationOverlay';
import {
  type MapStyleType,
  getMapStyle,
  isDarkStyle,
  getNextStyle,
  getStyleIcon,
  MAP_ATTRIBUTIONS,
  TERRAIN_ATTRIBUTION,
} from './mapStyles';
import type { ActivityType, RoutePoint } from '@/types';

/** Calculate distance between two coordinates using Haversine formula */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Result of section creation */
export interface SectionCreationResult {
  /** GPS points for the section */
  polyline: RoutePoint[];
  /** Start index in activity coordinates */
  startIndex: number;
  /** End index in activity coordinates */
  endIndex: number;
  /** Distance in meters */
  distanceMeters: number;
}

interface ActivityMapViewProps {
  polyline?: string;
  coordinates?: LatLng[];
  activityType: ActivityType;
  height?: number;
  showStyleToggle?: boolean;
  initialStyle?: MapStyleType;
  /** Index into coordinates array to highlight (from elevation chart) */
  highlightIndex?: number | null;
  /** Enable fullscreen on tap */
  enableFullscreen?: boolean;
  /** Called when 3D mode is toggled - parent can disable scroll */
  on3DModeChange?: (is3D: boolean) => void;
  /** Enable section creation mode */
  creationMode?: boolean;
  /** Called when a section is created */
  onSectionCreated?: (result: SectionCreationResult) => void;
  /** Called when section creation is cancelled */
  onCreationCancelled?: () => void;
}

export function ActivityMapView({
  polyline: encodedPolyline,
  coordinates: providedCoordinates,
  activityType,
  height = 300,
  showStyleToggle = false,
  initialStyle,
  highlightIndex,
  enableFullscreen = false,
  on3DModeChange,
  creationMode = false,
  onSectionCreated,
  onCreationCancelled,
}: ActivityMapViewProps) {
  const { getStyleForActivity } = useMapPreferences();
  const preferredStyle = getStyleForActivity(activityType);
  const [mapStyle, setMapStyle] = useState<MapStyleType>(initialStyle ?? preferredStyle);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [is3DMode, setIs3DMode] = useState(false);
  const [is3DReady, setIs3DReady] = useState(false);
  const map3DRef = useRef<Map3DWebViewRef>(null);
  const map3DOpacity = useRef(new Animated.Value(0)).current;

  // Section creation state
  const [creationState, setCreationState] = useState<CreationState>('selectingStart');
  const [startIndex, setStartIndex] = useState<number | null>(null);
  const [endIndex, setEndIndex] = useState<number | null>(null);

  // Track if user manually overrode the style
  const [userOverride, setUserOverride] = useState(false);

  // Parse and validate coordinates early so they're available for callbacks
  const coordinates = useMemo(() => {
    if (providedCoordinates && providedCoordinates.length > 0) {
      return providedCoordinates;
    }
    if (encodedPolyline) {
      return decodePolyline(encodedPolyline);
    }
    return [];
  }, [encodedPolyline, providedCoordinates]);

  // Filter valid coordinates for bounds and route display
  const validCoordinates = useMemo(() => {
    return coordinates.filter((c) => !isNaN(c.latitude) && !isNaN(c.longitude));
  }, [coordinates]);

  // Update map style when preference changes (unless user manually toggled)
  useEffect(() => {
    if (!userOverride && !initialStyle && mapStyle !== preferredStyle) {
      setMapStyle(preferredStyle);
    }
  }, [userOverride, initialStyle, mapStyle, preferredStyle]);

  // Reset section creation state when mode changes
  useEffect(() => {
    if (creationMode) {
      setCreationState('selectingStart');
      setStartIndex(null);
      setEndIndex(null);
    }
  }, [creationMode]);

  const toggleMapStyle = useCallback(() => {
    setUserOverride(true);
    setMapStyle((current) => getNextStyle(current));
  }, []);

  // Toggle 3D mode
  const toggle3D = useCallback(() => {
    setIs3DMode((current) => !current);
  }, []);

  // Notify parent when 3D mode changes (outside of render cycle)
  useEffect(() => {
    on3DModeChange?.(is3DMode);
  }, [is3DMode, on3DModeChange]);

  // Reset 3D ready state when toggling off
  useEffect(() => {
    if (!is3DMode) {
      setIs3DReady(false);
      map3DOpacity.setValue(0);
    }
  }, [is3DMode, map3DOpacity]);

  // Handle 3D map ready
  const handleMap3DReady = useCallback(() => {
    setIs3DReady(true);
    Animated.timing(map3DOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [map3DOpacity]);

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
      // Silently fail
    }
  }, []);

  const openFullscreen = useCallback(() => {
    if (enableFullscreen) {
      setIsFullscreen(true);
    }
  }, [enableFullscreen]);

  const closeFullscreen = () => {
    setIsFullscreen(false);
  };

  // Handle map press - using MapView's native onPress instead of gesture detector
  // This properly distinguishes taps from zoom/pan gestures
  const handleMapPress = useCallback(
    (feature: GeoJSON.Feature) => {
      // In creation mode, handle point selection
      if (creationMode && feature.geometry.type === 'Point') {
        const [lng, lat] = feature.geometry.coordinates as [number, number];

        // Find nearest point on the route
        if (validCoordinates.length === 0) return;

        let nearestIndex = 0;
        let nearestDistance = Infinity;

        for (let i = 0; i < validCoordinates.length; i++) {
          const coord = validCoordinates[i];
          const dx = coord.longitude - lng;
          const dy = coord.latitude - lat;
          const dist = dx * dx + dy * dy;
          if (dist < nearestDistance) {
            nearestDistance = dist;
            nearestIndex = i;
          }
        }

        if (creationState === 'selectingStart') {
          setStartIndex(nearestIndex);
          setCreationState('selectingEnd');
        } else if (creationState === 'selectingEnd') {
          // Ensure end is after start
          if (nearestIndex <= (startIndex ?? 0)) {
            // Swap them
            setEndIndex(startIndex);
            setStartIndex(nearestIndex);
          } else {
            setEndIndex(nearestIndex);
          }
          setCreationState('complete');
        }
        return;
      }

      if (enableFullscreen) {
        openFullscreen();
      }
    },
    [enableFullscreen, openFullscreen, creationMode, creationState, startIndex, validCoordinates]
  );

  // Section creation handlers
  const handleCreationConfirm = useCallback(() => {
    if (startIndex === null || endIndex === null) return;

    // Extract section polyline
    const sectionCoords = validCoordinates.slice(startIndex, endIndex + 1);
    const polyline: RoutePoint[] = sectionCoords.map((c) => ({
      lat: c.latitude,
      lng: c.longitude,
    }));

    // Calculate distance using Haversine
    let distance = 0;
    for (let i = 1; i < sectionCoords.length; i++) {
      const prev = sectionCoords[i - 1];
      const curr = sectionCoords[i];
      distance += haversineDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    }

    onSectionCreated?.({
      polyline,
      startIndex,
      endIndex,
      distanceMeters: distance,
    });

    // Reset state
    setCreationState('selectingStart');
    setStartIndex(null);
    setEndIndex(null);
  }, [startIndex, endIndex, validCoordinates, onSectionCreated]);

  const handleCreationCancel = useCallback(() => {
    setCreationState('selectingStart');
    setStartIndex(null);
    setEndIndex(null);
    onCreationCancelled?.();
  }, [onCreationCancelled]);

  const handleCreationReset = useCallback(() => {
    setCreationState('selectingStart');
    setStartIndex(null);
    setEndIndex(null);
  }, []);

  // Compass bearing state
  const bearingAnim = useRef(new Animated.Value(0)).current;

  // Handle 3D map bearing changes (for compass sync)
  const handleBearingChange = useCallback(
    (bearing: number) => {
      bearingAnim.setValue(-bearing);
    },
    [bearingAnim]
  );

  // Handle map region change to update compass
  const handleRegionIsChanging = useCallback(
    (feature: GeoJSON.Feature) => {
      const properties = feature.properties as { heading?: number } | undefined;
      if (properties?.heading !== undefined) {
        bearingAnim.setValue(-properties.heading);
      }
    },
    [bearingAnim]
  );

  // Camera ref for programmatic control
  const cameraRef = useRef<React.ElementRef<typeof Camera>>(null);

  // Track if initial bounds have been applied - prevents camera reset on parent re-renders
  const [initialBoundsApplied, setInitialBoundsApplied] = useState(false);

  // Reset bearing to north
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
  }, [bearingAnim, is3DMode, is3DReady]);

  const bounds = useMemo(() => getMapLibreBounds(validCoordinates), [validCoordinates]);

  // Mark initial bounds as applied after first render with valid bounds
  useEffect(() => {
    if (bounds && !initialBoundsApplied) {
      // Small delay to ensure camera has time to apply bounds
      const timer = setTimeout(() => {
        setInitialBoundsApplied(true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [bounds, initialBoundsApplied]);

  const routeGeoJSON = useMemo(() => {
    if (validCoordinates.length === 0) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: validCoordinates.map((c) => [c.longitude, c.latitude]),
      },
    };
  }, [validCoordinates]);

  // Route coordinates for BaseMapView/Map3DWebView [lng, lat] format
  const routeCoords = useMemo(() => {
    return validCoordinates.map((c) => [c.longitude, c.latitude] as [number, number]);
  }, [validCoordinates]);

  const activityColor = getActivityColor(activityType);
  const startPoint = validCoordinates[0];
  const endPoint = validCoordinates[validCoordinates.length - 1];

  // Get the highlighted point from elevation chart selection
  const highlightPoint = useMemo(() => {
    if (highlightIndex != null && highlightIndex >= 0 && highlightIndex < coordinates.length) {
      const coord = coordinates[highlightIndex];
      if (coord && !isNaN(coord.latitude) && !isNaN(coord.longitude)) {
        return coord;
      }
    }
    return null;
  }, [highlightIndex, coordinates]);

  // Section creation: calculate section distance
  const sectionDistance = useMemo(() => {
    if (!creationMode || startIndex === null || endIndex === null) return null;
    const sectionCoords = validCoordinates.slice(startIndex, endIndex + 1);
    let distance = 0;
    for (let i = 1; i < sectionCoords.length; i++) {
      const prev = sectionCoords[i - 1];
      const curr = sectionCoords[i];
      distance += haversineDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    }
    return distance;
  }, [creationMode, startIndex, endIndex, validCoordinates]);

  // Section creation: GeoJSON for selected portion
  const sectionGeoJSON = useMemo(() => {
    if (!creationMode || startIndex === null) return null;
    const end = endIndex ?? startIndex;
    const sectionCoords = validCoordinates.slice(startIndex, end + 1);
    if (sectionCoords.length < 2) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: sectionCoords.map((c) => [c.longitude, c.latitude]),
      },
    };
  }, [creationMode, startIndex, endIndex, validCoordinates]);

  // Section creation: get selected start/end points for markers
  const sectionStartPoint =
    creationMode && startIndex !== null ? validCoordinates[startIndex] : null;
  const sectionEndPoint = creationMode && endIndex !== null ? validCoordinates[endIndex] : null;

  const mapStyleValue = getMapStyle(mapStyle);
  const isDark = isDarkStyle(mapStyle);

  if (!bounds || validCoordinates.length === 0) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <MaterialCommunityIcons name="map-marker-off" size={48} color={colors.textSecondary} />
      </View>
    );
  }

  const hasRoute = routeCoords.length > 0;

  return (
    <View style={[styles.outerContainer, { height }]}>
      <View style={styles.container}>
        {/* 2D Map layer - hidden when 3D is ready */}
        <View
          style={[
            styles.mapLayer,
            is3DMode && is3DReady && styles.hiddenLayer,
            isFullscreen && styles.hiddenLayer,
          ]}
        >
          <MapView
            style={styles.map}
            mapStyle={mapStyleValue}
            logoEnabled={false}
            attributionEnabled={false}
            compassEnabled={false}
            scrollEnabled={true}
            zoomEnabled={true}
            rotateEnabled={true}
            pitchEnabled={false}
            onRegionIsChanging={handleRegionIsChanging}
            onPress={handleMapPress}
          >
            <Camera
              ref={cameraRef}
              // Only apply bounds on initial mount - prevents camera reset on parent re-renders
              // After initial bounds are applied, user can freely pan/zoom
              {...(!initialBoundsApplied && bounds
                ? {
                    bounds,
                    padding: {
                      paddingTop: 50,
                      paddingRight: 50,
                      paddingBottom: 50,
                      paddingLeft: 50,
                    },
                  }
                : {})}
              animationDuration={0}
            />

            {/* Route line */}
            {routeGeoJSON && (
              <ShapeSource id="routeSource" shape={routeGeoJSON}>
                <LineLayer
                  id="routeLine"
                  style={{
                    lineColor: activityColor,
                    lineWidth: 4,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              </ShapeSource>
            )}

            {/* Start marker */}
            {startPoint && (
              <MarkerView coordinate={[startPoint.longitude, startPoint.latitude]}>
                <View style={styles.markerContainer}>
                  <View style={[styles.marker, styles.startMarker]}>
                    <MaterialCommunityIcons name="play" size={14} color={colors.textOnDark} />
                  </View>
                </View>
              </MarkerView>
            )}

            {/* End marker */}
            {endPoint && (
              <MarkerView coordinate={[endPoint.longitude, endPoint.latitude]}>
                <View style={styles.markerContainer}>
                  <View style={[styles.marker, styles.endMarker]}>
                    <MaterialCommunityIcons
                      name="flag-checkered"
                      size={14}
                      color={colors.textOnDark}
                    />
                  </View>
                </View>
              </MarkerView>
            )}

            {/* Highlight marker from elevation chart */}
            {highlightPoint && (
              <MarkerView coordinate={[highlightPoint.longitude, highlightPoint.latitude]}>
                <View style={styles.markerContainer}>
                  <View style={styles.highlightMarker}>
                    <View style={styles.highlightMarkerInner} />
                  </View>
                </View>
              </MarkerView>
            )}

            {/* Section creation: selected section line */}
            {sectionGeoJSON && (
              <ShapeSource id="sectionSource" shape={sectionGeoJSON}>
                <LineLayer
                  id="sectionLine"
                  style={{
                    lineColor: colors.success,
                    lineWidth: 6,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              </ShapeSource>
            )}

            {/* Section creation: start marker */}
            {sectionStartPoint && (
              <MarkerView coordinate={[sectionStartPoint.longitude, sectionStartPoint.latitude]}>
                <View style={styles.markerContainer}>
                  <View style={[styles.marker, styles.sectionStartMarker]}>
                    <MaterialCommunityIcons name="flag" size={14} color={colors.textOnDark} />
                  </View>
                </View>
              </MarkerView>
            )}

            {/* Section creation: end marker */}
            {sectionEndPoint && (
              <MarkerView coordinate={[sectionEndPoint.longitude, sectionEndPoint.latitude]}>
                <View style={styles.markerContainer}>
                  <View style={[styles.marker, styles.sectionEndMarker]}>
                    <MaterialCommunityIcons
                      name="flag-checkered"
                      size={14}
                      color={colors.textOnDark}
                    />
                  </View>
                </View>
              </MarkerView>
            )}
          </MapView>
        </View>

        {/* 3D Map layer */}
        {is3DMode && hasRoute && !isFullscreen && (
          <Animated.View style={[styles.mapLayer, styles.map3DLayer, { opacity: map3DOpacity }]}>
            <Map3DWebView
              ref={map3DRef}
              coordinates={routeCoords}
              mapStyle={mapStyle}
              routeColor={activityColor}
              onMapReady={handleMap3DReady}
              onBearingChange={handleBearingChange}
            />
          </Animated.View>
        )}

        {/* Attribution */}
        {showStyleToggle && !isFullscreen && (
          <View style={styles.attribution}>
            <Text style={styles.attributionText}>
              {is3DMode
                ? `${MAP_ATTRIBUTIONS[mapStyle]} | ${TERRAIN_ATTRIBUTION}`
                : MAP_ATTRIBUTIONS[mapStyle]}
            </Text>
          </View>
        )}
      </View>

      {/* Control buttons - rendered OUTSIDE map container for reliable touch handling */}
      {showStyleToggle && !isFullscreen && (
        <View style={styles.controlsContainer}>
          {/* Style toggle */}
          <TouchableOpacity
            style={[styles.controlButton, isDark && styles.controlButtonDark]}
            onPressIn={toggleMapStyle}
            activeOpacity={0.6}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <MaterialCommunityIcons
              name={getStyleIcon(mapStyle)}
              size={22}
              color={isDark ? colors.textOnDark : colors.textSecondary}
            />
          </TouchableOpacity>

          {/* 3D toggle */}
          {hasRoute && (
            <TouchableOpacity
              style={[
                styles.controlButton,
                isDark && styles.controlButtonDark,
                is3DMode && styles.controlButtonActive,
              ]}
              onPressIn={toggle3D}
              activeOpacity={0.6}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
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

          {/* Compass */}
          <TouchableOpacity
            style={[styles.controlButton, isDark && styles.controlButtonDark]}
            onPressIn={resetOrientation}
            activeOpacity={0.6}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <CompassArrow
              size={22}
              rotation={bearingAnim}
              northColor={colors.error}
              southColor={isDark ? colors.textOnDark : colors.textSecondary}
            />
          </TouchableOpacity>

          {/* GPS location */}
          <TouchableOpacity
            style={[styles.controlButton, isDark && styles.controlButtonDark]}
            onPress={handleGetLocation}
            activeOpacity={0.6}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <MaterialCommunityIcons
              name="crosshairs-gps"
              size={22}
              color={isDark ? colors.textOnDark : colors.textSecondary}
            />
          </TouchableOpacity>
        </View>
      )}

      {/* Fullscreen modal using BaseMapView */}
      <Modal
        visible={isFullscreen}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeFullscreen}
      >
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
        <BaseMapView
          routeCoordinates={routeCoords}
          routeColor={activityColor}
          bounds={bounds}
          initialStyle={mapStyle}
          onClose={closeFullscreen}
        >
          {/* Start marker */}
          {startPoint && (
            <MarkerView coordinate={[startPoint.longitude, startPoint.latitude]}>
              <View style={styles.markerContainer}>
                <View style={[styles.marker, styles.startMarker]}>
                  <MaterialCommunityIcons name="play" size={14} color={colors.textOnDark} />
                </View>
              </View>
            </MarkerView>
          )}

          {/* End marker */}
          {endPoint && (
            <MarkerView coordinate={[endPoint.longitude, endPoint.latitude]}>
              <View style={styles.markerContainer}>
                <View style={[styles.marker, styles.endMarker]}>
                  <MaterialCommunityIcons
                    name="flag-checkered"
                    size={14}
                    color={colors.textOnDark}
                  />
                </View>
              </View>
            </MarkerView>
          )}
        </BaseMapView>
      </Modal>

      {/* Section creation overlay */}
      {creationMode && (
        <SectionCreationOverlay
          state={creationState}
          startIndex={startIndex}
          endIndex={endIndex}
          coordinateCount={validCoordinates.length}
          sectionDistance={sectionDistance}
          onConfirm={handleCreationConfirm}
          onCancel={handleCreationCancel}
          onReset={handleCreationReset}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    position: 'relative',
  },
  container: {
    flex: 1,
    borderRadius: layout.borderRadius,
    overflow: 'hidden',
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
  placeholder: {
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: layout.borderRadius,
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: colors.textOnDark,
    ...shadows.elevated,
  },
  startMarker: {
    backgroundColor: colors.success,
  },
  endMarker: {
    backgroundColor: colors.error,
  },
  sectionStartMarker: {
    backgroundColor: colors.success,
  },
  sectionEndMarker: {
    backgroundColor: colors.primary,
  },
  highlightMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: colors.textOnDark,
    ...shadows.elevated,
  },
  highlightMarkerInner: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: spacing.xs,
    backgroundColor: colors.textOnDark,
  },
  controlsContainer: {
    position: 'absolute',
    top: 48,
    right: layout.cardMargin,
    gap: spacing.sm,
    zIndex: 100,
    elevation: 100,
  },
  controlButton: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    borderRadius: layout.minTapTarget / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.modal,
  },
  controlButtonDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  controlButtonActive: {
    backgroundColor: colors.primary,
  },
  attribution: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: spacing.xs,
    zIndex: 10,
  },
  attributionText: {
    fontSize: 8,
    color: colors.textSecondary,
  },
});
