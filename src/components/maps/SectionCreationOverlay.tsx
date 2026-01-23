/**
 * Overlay component for creating custom sections on an activity map.
 * Compact bottom bar design that maximizes map visibility.
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Animated,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import { shadows } from '@/theme/shadows';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export type CreationState = 'idle' | 'selectingStart' | 'selectingEnd' | 'confirming' | 'complete';

interface SectionCreationOverlayProps {
  /** Current creation state */
  state: CreationState;
  /** Selected start point index */
  startIndex: number | null;
  /** Selected end point index */
  endIndex: number | null;
  /** Total number of coordinates in track */
  coordinateCount: number;
  /** Distance of selected section in meters */
  sectionDistance: number | null;
  /** Number of GPS points in the selected section */
  sectionPointCount: number | null;
  /** Called when user confirms the section */
  onConfirm: () => void;
  /** Called when user cancels creation */
  onCancel: () => void;
  /** Called to reset selection */
  onReset: () => void;
}

/**
 * Get color based on section point count.
 * Correlates with storage size (~65 bytes/point, 500KB limit ≈ 7,700 points).
 * Green: <2000, Yellow: 2000-5000, Orange: 5000-7000, Red: >7000
 */
function getSectionSizeColor(pointCount: number | null): string {
  if (pointCount === null) return colors.primary;
  if (pointCount < 2000) return colors.success;
  if (pointCount < 5000) return '#FFC107';
  if (pointCount < 7000) return '#FF9800';
  return colors.error;
}

/**
 * Get warning message for large sections.
 * Returns null if section size is acceptable.
 */
function getSectionSizeWarning(pointCount: number | null): string | null {
  if (pointCount === null) return null;
  if (pointCount >= 7000) return 'Section may be too large to save';
  if (pointCount >= 5000) return 'Large section - may affect performance';
  return null;
}

/**
 * Compact bottom bar overlay for section creation.
 * Shows status pill in center with action buttons on sides.
 */
export function SectionCreationOverlay({
  state,
  startIndex,
  endIndex,
  coordinateCount,
  sectionDistance,
  sectionPointCount,
  onConfirm,
  onCancel,
  onReset,
}: SectionCreationOverlayProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);

  const formatDistance = (meters: number) => {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${Math.round(meters)} m`;
  };

  const getStatusIcon = (): keyof typeof MaterialCommunityIcons.glyphMap => {
    switch (state) {
      case 'idle':
      case 'selectingStart':
        return 'flag-outline';
      case 'selectingEnd':
        return 'flag-checkered';
      case 'complete':
        return 'check-circle';
      default:
        return 'flag-outline';
    }
  };

  const getStatusText = () => {
    switch (state) {
      case 'idle':
      case 'selectingStart':
        return t('maps.tapSelectStart' as never);
      case 'selectingEnd':
        return t('maps.tapSelectEnd' as never);
      case 'complete':
        if (sectionDistance !== null) {
          return formatDistance(sectionDistance);
        }
        return t('maps.sectionSelected' as never);
      default:
        return '';
    }
  };

  const getProgress = () => {
    if (startIndex === null || coordinateCount === 0) return null;
    const startPercent = ((startIndex / coordinateCount) * 100).toFixed(0);
    if (endIndex === null) {
      return `${startPercent}%`;
    }
    const endPercent = ((endIndex / coordinateCount) * 100).toFixed(0);
    return `${startPercent}% - ${endPercent}%`;
  };

  const toggleExpanded = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(!expanded);
  };

  const isComplete = state === 'complete';
  const hasSelection = startIndex !== null;
  const statusColor = isComplete ? getSectionSizeColor(sectionPointCount) : colors.primary;
  const sizeWarning = isComplete ? getSectionSizeWarning(sectionPointCount) : null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* Compact bottom bar */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        {/* Cancel button */}
        <TouchableOpacity
          style={[styles.iconButton, styles.cancelButton]}
          onPress={onCancel}
          activeOpacity={0.8}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons name="close" size={22} color={colors.textOnDark} />
        </TouchableOpacity>

        {/* Center status pill - expandable */}
        <TouchableOpacity
          style={[styles.statusPill, expanded && styles.statusPillExpanded]}
          onPress={toggleExpanded}
          activeOpacity={0.9}
        >
          <View style={styles.statusRow}>
            <MaterialCommunityIcons name={getStatusIcon()} size={18} color={statusColor} />
            <Text style={[styles.statusText, isComplete && { color: statusColor }]}>
              {getStatusText()}
            </Text>
            {(hasSelection || isComplete) && (
              <MaterialCommunityIcons
                name={expanded ? 'chevron-down' : 'chevron-up'}
                size={16}
                color={colors.textSecondary}
              />
            )}
          </View>

          {/* Expanded details */}
          {expanded && hasSelection && (
            <View style={styles.expandedContent}>
              {getProgress() && (
                <View style={styles.detailRow}>
                  <MaterialCommunityIcons name="percent" size={14} color={colors.textSecondary} />
                  <Text style={styles.detailText}>{getProgress()}</Text>
                </View>
              )}
              {sectionPointCount !== null && (
                <View style={styles.detailRow}>
                  <MaterialCommunityIcons
                    name="map-marker-multiple"
                    size={14}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.detailText}>
                    {t('routes.pointCountHint', { count: sectionPointCount })}
                  </Text>
                </View>
              )}
              {sizeWarning && (
                <View style={styles.warningRow}>
                  <MaterialCommunityIcons name="alert-outline" size={14} color={statusColor} />
                  <Text style={[styles.detailText, { color: statusColor }]}>{sizeWarning}</Text>
                </View>
              )}
              {/* Reset option in expanded view */}
              <TouchableOpacity style={styles.resetRow} onPress={onReset}>
                <MaterialCommunityIcons name="refresh" size={14} color={colors.primary} />
                <Text style={styles.resetText}>{t('common.reset' as never)}</Text>
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>

        {/* Create button - only when complete */}
        {isComplete ? (
          <TouchableOpacity
            style={[styles.iconButton, styles.confirmButton]}
            onPress={onConfirm}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialCommunityIcons name="check" size={22} color={colors.textOnDark} />
          </TouchableOpacity>
        ) : (
          <View style={styles.iconButtonPlaceholder} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 200,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.elevated,
  },
  iconButtonPlaceholder: {
    width: 44,
    height: 44,
  },
  cancelButton: {
    backgroundColor: colors.error,
  },
  confirmButton: {
    backgroundColor: colors.success,
  },
  statusPill: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 22,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
    ...shadows.elevated,
  },
  statusPillExpanded: {
    borderRadius: layout.borderRadius,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  statusText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  expandedContent: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.xs,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  detailText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  resetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
  },
  resetText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
});
