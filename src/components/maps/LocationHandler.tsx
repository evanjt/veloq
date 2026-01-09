/**
 * @fileoverview LocationHandler - GPS location button
 *
 * Provides a floating button to get user's current location and animate the map camera to it.
 * Requests foreground permissions on demand and handles permission denial gracefully.
 */

import React, { useRef, useEffect, useCallback } from "react";
import { TouchableOpacity, StyleSheet, ViewStyle } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import type { Camera } from "@maplibre/maplibre-react-native";
import { colors } from "@/theme/colors";
import { shadows } from "@/theme/shadows";
import { spacing } from "@/theme/spacing";

interface LocationHandlerProps {
  /** MapLibre Camera ref for animating to location */
  cameraRef: React.RefObject<React.ElementRef<typeof Camera> | null>;
  /** Callback to update user location marker position */
  onLocationUpdate: (coords: [number, number] | null) => void;
  /** Optional container style */
  style?: ViewStyle;
}

/**
 * GPS location button.
 *
 * Requests foreground location permissions on first tap, then animates the map
 * camera to the user's current position. Shows a location marker for 3 seconds.
 *
 * Silently fails if permission is denied or location services are unavailable.
 *
 * @example
 * ```tsx
 * <LocationHandler
 *   cameraRef={cameraRef}
 *   onLocationUpdate={setUserLocation}
 * />
 * ```
 */
export function LocationHandler({
  cameraRef,
  onLocationUpdate,
  style,
}: LocationHandlerProps) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Get user location (one-time jump, no tracking)
  const handleGetLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords: [number, number] = [
        location.coords.longitude,
        location.coords.latitude,
      ];
      onLocationUpdate(coords);

      cameraRef.current?.setCamera({
        centerCoordinate: coords,
        zoomLevel: 13,
        animationDuration: 500,
      });

      // Clear previous timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Clear location marker after 3 seconds
      timeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          onLocationUpdate(null);
        }
      }, 3000);
    } catch {
      // Silently fail - location is optional
    }
  }, [cameraRef, onLocationUpdate]);

  // Clean up timeout on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <TouchableOpacity
      style={[styles.button, style]}
      onPress={handleGetLocation}
      activeOpacity={0.7}
      accessibilityLabel="Show my location"
      accessibilityHint="Animates map to your current GPS position"
    >
      <MaterialCommunityIcons
        name="crosshairs-gps"
        size={28}
        color={colors.text.primary}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.background.paper,
    justifyContent: "center",
    alignItems: "center",
    ...shadows.md,
  },
});
