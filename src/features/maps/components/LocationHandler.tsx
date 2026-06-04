/**
 * @fileoverview LocationHandler - GPS location button
 *
 * Provides a floating button to get user's current location and animate the map camera to it.
 * Requests foreground permissions on demand and handles permission denial gracefully.
 */

import React, { useCallback } from 'react';
import { TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import type { Camera } from '@maplibre/maplibre-react-native';
import { colors, shadows, spacing } from '@/theme';

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
 * camera to the user's current position. Shows a location marker that stays
 * visible until the component unmounts.
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
export function LocationHandler({ cameraRef, onLocationUpdate, style }: LocationHandlerProps) {
  const { t } = useTranslation();
  // Get user location (one-time jump, no tracking)
  // Shows location dot and zooms once - dot stays visible until component unmounts
  const handleGetLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords: [number, number] = [location.coords.longitude, location.coords.latitude];
      onLocationUpdate(coords);

      cameraRef.current?.setCamera({
        centerCoordinate: coords,
        zoomLevel: 13,
        animationDuration: 500,
      });

      // Note: User location dot stays visible until component unmounts
      // No auto-clear timeout - user can pan away freely after zoom
    } catch {
      // Silently fail - location is optional
    }
  }, [cameraRef, onLocationUpdate]);

  return (
    <TouchableOpacity
      style={[styles.button, style]}
      onPress={handleGetLocation}
      activeOpacity={0.7}
      accessibilityLabel={t('maps.showMyLocation')}
      accessibilityHint={t('maps.showMyLocationHint')}
    >
      <MaterialCommunityIcons name="crosshairs-gps" size={28} color={colors.textPrimary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.card,
  },
});
