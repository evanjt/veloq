/**
 * Control button stack for RegionalMapView.
 * Contains 3D toggle, compass, location, and layer controls.
 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet, Animated, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, shadows } from '@/theme';
import { CompassArrow } from '@/components/ui';
import type { FrequentSection } from '@/types';

interface MapControlStackProps {
  /** Top position offset (includes safe area) */
  top: number;
  /** Whether dark mode is active */
  isDark: boolean;
  /** Whether 3D mode is enabled */
  is3DMode: boolean;
  /** Whether 3D can be enabled (has route data) */
  can3D: boolean;
  /** Whether activities are visible */
  showActivities: boolean;
  /** Whether sections are visible */
  showSections: boolean;
  /** Whether routes are visible */
  showRoutes: boolean;
  /** Whether user location is active */
  userLocationActive: boolean;
  /** Whether location is currently being fetched */
  locationLoading: boolean;
  /** Sections data (for showing sections toggle) */
  sections: FrequentSection[];
  /** Number of routes (for showing routes toggle) */
  routeCount: number;
  /** Number of activities (for showing activities toggle) */
  activityCount: number;
  /** Animated bearing value for compass */
  bearingAnim: Animated.Value;
  /** Callback to toggle 3D mode */
  onToggle3D: () => void;
  /** Callback to reset orientation */
  onResetOrientation: () => void;
  /** Callback to get user location */
  onGetLocation: () => void;
  /** Callback to toggle activities */
  onToggleActivities: () => void;
  /** Callback to toggle sections */
  onToggleSections: () => void;
  /** Callback to toggle routes */
  onToggleRoutes: () => void;
  /** Callback to fit all activities in view */
  onFitAll: () => void;
}

export function MapControlStack({
  top,
  isDark,
  is3DMode,
  can3D,
  showActivities,
  showSections,
  showRoutes,
  userLocationActive,
  locationLoading,
  sections,
  routeCount,
  activityCount,
  bearingAnim,
  onToggle3D,
  onResetOrientation,
  onGetLocation,
  onToggleActivities,
  onToggleSections,
  onToggleRoutes,
  onFitAll,
}: MapControlStackProps) {
  const { t } = useTranslation();
  const show3D = is3DMode && can3D;

  return (
    <View style={[styles.controlStack, { top }]}>
      {/* 3D Toggle - only active when activity with route is selected */}
      <TouchableOpacity
        testID="map-toggle-3d"
        style={[
          styles.controlButton,
          isDark && styles.controlButtonDark,
          show3D && styles.controlButtonActive,
          !can3D && styles.controlButtonDisabled,
        ]}
        onPress={can3D ? onToggle3D : undefined}
        activeOpacity={can3D ? 0.8 : 1}
        disabled={!can3D}
        accessibilityLabel={show3D ? t('maps.disable3D') : t('maps.enable3D')}
        accessibilityRole="button"
        accessibilityState={{ disabled: !can3D }}
      >
        <MaterialCommunityIcons
          name="terrain"
          size={22}
          color={
            show3D
              ? colors.textOnDark
              : can3D
                ? isDark
                  ? colors.textOnDark
                  : colors.textSecondary
                : isDark
                  ? darkColors.textMuted
                  : colors.textDisabled
          }
        />
      </TouchableOpacity>

      {/* North Arrow - tap to reset orientation */}
      <TouchableOpacity
        testID="map-compass"
        style={[styles.controlButton, isDark && styles.controlButtonDark]}
        onPress={onResetOrientation}
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

      {/* Combined location + fit-all button
          Shows both icons stacked: location on top, fit-all on bottom
          Tap top half = go to location, tap bottom half = fit all */}
      <View style={styles.dualButtonContainer}>
        {/* Top: Location */}
        <TouchableOpacity
          testID="map-location"
          style={[
            styles.dualButtonHalf,
            isDark && styles.controlButtonDark,
            userLocationActive && styles.controlButtonActive,
            styles.dualButtonTop,
          ]}
          onPress={locationLoading ? undefined : onGetLocation}
          activeOpacity={locationLoading ? 1 : 0.8}
          disabled={locationLoading}
          accessibilityLabel={t('maps.goToLocation')}
          accessibilityRole="button"
        >
          {locationLoading ? (
            <ActivityIndicator
              size="small"
              color={isDark ? colors.textOnDark : colors.textSecondary}
            />
          ) : (
            <MaterialCommunityIcons
              name="crosshairs-gps"
              size={18}
              color={
                userLocationActive
                  ? colors.textOnDark
                  : isDark
                    ? colors.textOnDark
                    : colors.textSecondary
              }
            />
          )}
        </TouchableOpacity>
        {/* Divider line */}
        <View style={[styles.dualButtonDivider, isDark && styles.dualButtonDividerDark]} />
        {/* Bottom: Fit All */}
        {activityCount > 0 && (
          <TouchableOpacity
            testID="map-fit-all"
            style={[
              styles.dualButtonHalf,
              isDark && styles.controlButtonDark,
              styles.dualButtonBottom,
            ]}
            onPress={onFitAll}
            activeOpacity={0.8}
            accessibilityLabel={t('maps.fitAll')}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons
              name="fit-to-screen-outline"
              size={18}
              color={isDark ? colors.textOnDark : colors.textSecondary}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Combined layer toggles (activities/sections/routes) - stacked when multiple exist */}
      {(activityCount > 0 || sections.length > 0 || routeCount > 0) && (
        <View style={[styles.layerToggleContainer, isDark && styles.layerToggleContainerDark]}>
          {/* Activities toggle */}
          {activityCount > 0 && (
            <>
              <TouchableOpacity
                testID="map-toggle-activities"
                style={[
                  styles.layerToggleItem,
                  showActivities && styles.controlButtonActive,
                  // Round top if first item
                  sections.length === 0 && routeCount === 0 && styles.layerToggleSingle,
                  (sections.length > 0 || routeCount > 0) && styles.layerToggleTop,
                ]}
                onPress={onToggleActivities}
                activeOpacity={0.8}
                accessibilityLabel={
                  showActivities ? t('maps.hideActivities') : t('maps.showActivities')
                }
                accessibilityRole="button"
              >
                <MaterialCommunityIcons
                  name="map-marker-multiple"
                  size={18}
                  color={
                    showActivities
                      ? colors.textOnDark
                      : isDark
                        ? colors.textOnDark
                        : colors.textSecondary
                  }
                />
              </TouchableOpacity>
              {(sections.length > 0 || routeCount > 0) && (
                <View style={[styles.dualButtonDivider, isDark && styles.dualButtonDividerDark]} />
              )}
            </>
          )}
          {/* Sections toggle */}
          {sections.length > 0 && (
            <>
              <TouchableOpacity
                testID="map-toggle-sections"
                style={[
                  styles.layerToggleItem,
                  showSections && styles.controlButtonActive,
                  // Round appropriately based on position
                  activityCount === 0 && routeCount === 0 && styles.layerToggleSingle,
                  activityCount === 0 && routeCount > 0 && styles.layerToggleTop,
                  activityCount > 0 && routeCount === 0 && styles.layerToggleBottom,
                ]}
                onPress={onToggleSections}
                activeOpacity={0.8}
                accessibilityLabel={showSections ? t('maps.hideSections') : t('maps.showSections')}
                accessibilityRole="button"
              >
                <MaterialCommunityIcons
                  name="road-variant"
                  size={18}
                  color={
                    showSections
                      ? colors.textOnDark
                      : isDark
                        ? colors.textOnDark
                        : colors.textSecondary
                  }
                />
              </TouchableOpacity>
              {routeCount > 0 && (
                <View style={[styles.dualButtonDivider, isDark && styles.dualButtonDividerDark]} />
              )}
            </>
          )}
          {/* Routes toggle */}
          {routeCount > 0 && (
            <TouchableOpacity
              testID="map-toggle-routes"
              style={[
                styles.layerToggleItem,
                showRoutes && styles.controlButtonActive,
                // Round appropriately based on position
                activityCount === 0 && sections.length === 0 && styles.layerToggleSingle,
                (activityCount > 0 || sections.length > 0) && styles.layerToggleBottom,
              ]}
              onPress={onToggleRoutes}
              activeOpacity={0.8}
              accessibilityLabel={showRoutes ? t('maps.hideRoutes') : t('maps.showRoutes')}
              accessibilityRole="button"
            >
              <MaterialCommunityIcons
                name="map-marker-path"
                size={18}
                color={
                  showRoutes ? colors.textOnDark : isDark ? colors.textOnDark : colors.textSecondary
                }
              />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  controlStack: {
    position: 'absolute',
    right: spacing.md,
    gap: spacing.sm,
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
  controlButtonDisabled: {
    opacity: 0.5,
  },
  // Dual button styles (location + fit-all combined)
  dualButtonContainer: {
    width: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    overflow: 'hidden',
    ...shadows.mapOverlay,
  },
  dualButtonHalf: {
    width: 40,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dualButtonTop: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  dualButtonBottom: {
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  dualButtonDivider: {
    height: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    marginHorizontal: 8,
  },
  dualButtonDividerDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  // Layer toggle styles (activities/sections/routes combined)
  layerToggleContainer: {
    width: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    overflow: 'hidden',
    ...shadows.mapOverlay,
  },
  layerToggleContainerDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  layerToggleItem: {
    width: 40,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  layerToggleSingle: {
    borderRadius: 20,
  },
  layerToggleTop: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  layerToggleBottom: {
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
});
