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
  /** Whether sections are visible */
  showSections: boolean;
  /** Whether user location is active */
  userLocationActive: boolean;
  /** Heatmap data (for showing heatmap toggle) */
  heatmap: HeatmapResult | null;
  /** Sections data (for showing sections toggle) */
  sections: FrequentSection[];
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
  /** Callback to toggle sections */
  onToggleSections: () => void;
}

export function MapControlStack({
  top,
  isDark,
  is3DMode,
  can3D,
  isHeatmapMode,
  showSections,
  userLocationActive,
  heatmap,
  sections,
  bearingAnim,
  onToggle3D,
  onResetOrientation,
  onGetLocation,
  onToggleHeatmap,
  onToggleSections,
}: MapControlStackProps) {
  const { t } = useTranslation();
  const show3D = is3DMode && can3D;

  return (
    <View style={[styles.controlStack, { top }]}>
      {/* 3D Toggle - only active when activity with route is selected */}
      <TouchableOpacity
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

      {/* Heatmap toggle - only shown when heatmap data is available */}
      {heatmap && heatmap.cells.length > 0 && (
        <TouchableOpacity
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

      {/* Sections toggle - only shown when sections exist and not in heatmap mode */}
      {sections.length > 0 && !isHeatmapMode && (
        <TouchableOpacity
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
