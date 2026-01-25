/**
 * Control button stack for RegionalMapView.
 * Contains 3D toggle, compass, location, heatmap, and sections controls.
 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { shadows } from '@/theme/shadows';
import { CompassArrow } from '@/components/ui';
import type { HeatmapResult } from '@/hooks/useHeatmap';
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
  /** Whether heatmap mode is enabled */
  isHeatmapMode: boolean;
  /** Whether activities are visible */
  showActivities: boolean;
  /** Whether sections are visible */
  showSections: boolean;
  /** Whether routes are visible */
  showRoutes: boolean;
  /** Whether user location is active */
  userLocationActive: boolean;
  /** Heatmap data (for showing heatmap toggle) */
  heatmap: HeatmapResult | null;
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
  /** Callback to toggle heatmap */
  onToggleHeatmap: () => void;
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
  isHeatmapMode,
  showActivities,
  showSections,
  showRoutes,
  userLocationActive,
  heatmap,
  sections,
  routeCount,
  activityCount,
  bearingAnim,
  onToggle3D,
  onResetOrientation,
  onGetLocation,
  onToggleHeatmap,
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

      {/* Location button */}
      <TouchableOpacity
        testID="map-location"
        style={[
          styles.controlButton,
          isDark && styles.controlButtonDark,
          userLocationActive && styles.controlButtonActive,
        ]}
        onPress={onGetLocation}
        activeOpacity={0.8}
        accessibilityLabel={t('maps.goToLocation')}
        accessibilityRole="button"
      >
        <MaterialCommunityIcons
          name="crosshairs-gps"
          size={22}
          color={
            userLocationActive
              ? colors.textOnDark
              : isDark
                ? colors.textOnDark
                : colors.textSecondary
          }
        />
      </TouchableOpacity>

      {/* Fit all activities in view */}
      {activityCount > 0 && (
        <TouchableOpacity
          testID="map-fit-all"
          style={[styles.controlButton, isDark && styles.controlButtonDark]}
          onPress={onFitAll}
          activeOpacity={0.8}
          accessibilityLabel={t('maps.fitAll')}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons
            name="fit-to-screen-outline"
            size={22}
            color={isDark ? colors.textOnDark : colors.textSecondary}
          />
        </TouchableOpacity>
      )}

      {/* Heatmap toggle - only shown when heatmap data is available */}
      {heatmap && heatmap.cells.length > 0 && (
        <TouchableOpacity
          testID="map-toggle-heatmap"
          style={[
            styles.controlButton,
            isDark && styles.controlButtonDark,
            isHeatmapMode && styles.controlButtonActive,
          ]}
          onPress={onToggleHeatmap}
          activeOpacity={0.8}
          accessibilityLabel={isHeatmapMode ? 'Show activities' : 'Show heatmap'}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons
            name="fire"
            size={22}
            color={
              isHeatmapMode ? colors.textOnDark : isDark ? colors.textOnDark : colors.textSecondary
            }
          />
        </TouchableOpacity>
      )}

      {/* Activities toggle - only shown when activities exist and not in heatmap mode */}
      {activityCount > 0 && !isHeatmapMode && (
        <TouchableOpacity
          testID="map-toggle-activities"
          style={[
            styles.controlButton,
            isDark && styles.controlButtonDark,
            showActivities && styles.controlButtonActive,
          ]}
          onPress={onToggleActivities}
          activeOpacity={0.8}
          accessibilityLabel={showActivities ? 'Hide activities' : 'Show activities'}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons
            name="map-marker-multiple"
            size={22}
            color={
              showActivities ? colors.textOnDark : isDark ? colors.textOnDark : colors.textSecondary
            }
          />
        </TouchableOpacity>
      )}

      {/* Sections toggle - only shown when sections exist and not in heatmap mode */}
      {sections.length > 0 && !isHeatmapMode && (
        <TouchableOpacity
          testID="map-toggle-sections"
          style={[
            styles.controlButton,
            isDark && styles.controlButtonDark,
            showSections && styles.controlButtonActive,
          ]}
          onPress={onToggleSections}
          activeOpacity={0.8}
          accessibilityLabel={showSections ? 'Hide sections' : 'Show sections'}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons
            name="road-variant"
            size={22}
            color={
              showSections ? colors.textOnDark : isDark ? colors.textOnDark : colors.textSecondary
            }
          />
        </TouchableOpacity>
      )}

      {/* Routes toggle - only shown when routes exist and not in heatmap mode */}
      {routeCount > 0 && !isHeatmapMode && (
        <TouchableOpacity
          testID="map-toggle-routes"
          style={[
            styles.controlButton,
            isDark && styles.controlButtonDark,
            showRoutes && styles.controlButtonActive,
          ]}
          onPress={onToggleRoutes}
          activeOpacity={0.8}
          accessibilityLabel={showRoutes ? t('maps.hideRoutes') : t('maps.showRoutes')}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons
            name="map-marker-path"
            size={22}
            color={
              showRoutes ? colors.textOnDark : isDark ? colors.textOnDark : colors.textSecondary
            }
          />
        </TouchableOpacity>
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
});
