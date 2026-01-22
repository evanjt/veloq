/**
 * Overlay component for creating custom sections on an activity map.
 * Handles tap-to-select start/end points and displays visual feedback.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import { shadows } from '@/theme/shadows';

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
 * Get color based on section distance.
 * Green: <10km, Yellow: 10-30km, Orange: 30-50km, Red: >50km
 */
function getSectionSizeColor(distanceMeters: number | null): string {
  if (distanceMeters === null) return colors.primary;
  if (distanceMeters < 10000) return colors.success; // Green: <10km
  if (distanceMeters < 30000) return '#FFC107'; // Yellow: 10-30km
  if (distanceMeters < 50000) return '#FF9800'; // Orange: 30-50km
  return colors.error; // Red: >50km
}

/**
 * Overlay UI for section creation mode.
 * Shows instructions, selection status, and confirm/cancel buttons.
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

  const getInstructions = () => {
    switch (state) {
      case 'idle':
      case 'selectingStart':
        return t('maps.tapSelectStart' as never);
      case 'selectingEnd':
        return t('maps.tapSelectEnd' as never);
      case 'complete':
        return t('maps.sectionSelected' as never);
    }
  };

  const formatDistance = (meters: number) => {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${Math.round(meters)} m`;
  };

  const getProgress = () => {
    if (startIndex === null) return null;
    const startPercent = ((startIndex / coordinateCount) * 100).toFixed(0);
    if (endIndex === null) {
      return t('maps.startPercent' as never, { percent: startPercent });
    }
    const endPercent = ((endIndex / coordinateCount) * 100).toFixed(0);
    return t('maps.rangePercent' as never, {
      start: startPercent,
      end: endPercent,
    });
  };

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* Top instruction banner - positioned below Dynamic Island/notch */}
      <View style={[styles.instructionBanner, { marginTop: insets.top }]}>
        <View style={styles.instructionContent}>
          <MaterialCommunityIcons
            name={state === 'complete' ? 'check-circle' : 'gesture-tap'}
            size={20}
            color={state === 'complete' ? colors.success : colors.primary}
          />
          <Text style={styles.instructionText}>{getInstructions()}</Text>
        </View>
        {getProgress() && <Text style={styles.progressText}>{getProgress()}</Text>}
        {sectionDistance !== null && startIndex !== null && (
          <View style={styles.distanceContainer}>
            <Text style={[styles.distanceText, { color: getSectionSizeColor(sectionDistance) }]}>
              {formatDistance(sectionDistance)}
            </Text>
            {sectionPointCount !== null && sectionPointCount > 500 && (
              <Text style={styles.pointCountHint}>
                {t('routes.pointCountHint', { count: sectionPointCount })}
              </Text>
            )}
          </View>
        )}
      </View>

      {/* Bottom action buttons */}
      <View style={styles.actionContainer}>
        {/* Cancel button */}
        <TouchableOpacity
          style={[styles.actionButton, styles.cancelButton]}
          onPress={onCancel}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="close" size={24} color={colors.textOnDark} />
          <Text style={styles.buttonText}>{t('common.cancel')}</Text>
        </TouchableOpacity>

        {/* Reset button - only show when we have a selection */}
        {startIndex !== null && (
          <TouchableOpacity
            style={[styles.actionButton, styles.resetButton]}
            onPress={onReset}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="refresh" size={24} color={colors.textSecondary} />
            <Text style={[styles.buttonText, styles.resetButtonText]}>
              {t('common.reset' as never)}
            </Text>
          </TouchableOpacity>
        )}

        {/* Confirm button - only show when complete */}
        {state === 'complete' && (
          <TouchableOpacity
            style={[styles.actionButton, styles.confirmButton]}
            onPress={onConfirm}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="check" size={24} color={colors.textOnDark} />
            <Text style={styles.buttonText}>{t('common.create' as never)}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    padding: spacing.md,
    zIndex: 200,
  },
  instructionBanner: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    alignItems: 'center',
    ...shadows.modal,
  },
  instructionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  instructionText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  progressText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  distanceContainer: {
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  distanceText: {
    ...typography.body,
    fontWeight: '700',
    color: colors.primary,
  },
  pointCountHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  actionContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: layout.borderRadius,
    ...shadows.elevated,
  },
  cancelButton: {
    backgroundColor: colors.error,
  },
  resetButton: {
    backgroundColor: colors.surface,
  },
  confirmButton: {
    backgroundColor: colors.success,
  },
  buttonText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textOnDark,
  },
  resetButtonText: {
    color: colors.textSecondary,
  },
});
