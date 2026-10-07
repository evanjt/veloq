/**
 * Overlay component for creating custom sections on an activity map.
 * Compact bottom bar design that maximizes map visibility.
 */

import React, { useState } from 'react';
import {
  Pressable,
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  colors,
  darkColors,
  typography,
  spacing,
  layout,
  shadows,
  colorWithOpacity,
  ink,
} from '@/theme';
import { sectionSizeTone, type SizeTone } from '@/features/maps/lib/sectionSizeTone';
import { formatDistance } from '@/shared/format/format';
import { useMetricSystem, useTheme } from '@/shared/app';
import { pressable, pressRipple } from '@/shared/ui';

export type CreationState =
  | 'idle'
  | 'selectingStart'
  | 'selectingEnd'
  | 'confirming'
  | 'complete'
  | 'creating'
  | 'error';

/** Error details for debugging */
export interface SectionCreationError {
  /** User-friendly error message */
  message: string;
  /** Technical error from Rust/system */
  technicalDetails?: string | undefined;
  /** Activity ID for debugging */
  activityId?: string;
  /** Start/end indices for debugging */
  indices?: { start: number; end: number };
}

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
  /** Error details when state is 'error' */
  error?: SectionCreationError | null | undefined;
  /** Called when user confirms the section */
  onConfirm: () => void;
  /** Called when user cancels creation */
  onCancel: () => void;
  /** Called to reset selection */
  onReset: () => void;
  /** Called to dismiss error and retry */
  onDismissError?: (() => void) | undefined;
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
  error,
  onConfirm,
  onCancel,
  onReset,
  onDismissError,
}: SectionCreationOverlayProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isMetric = useMetricSystem();
  const [expanded, setExpanded] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  const getStatusIcon = (): keyof typeof MaterialCommunityIcons.glyphMap => {
    switch (state) {
      case 'idle':
      case 'selectingStart':
        return 'flag-outline';
      case 'selectingEnd':
        return 'flag-checkered';
      case 'complete':
        return 'check-circle';
      case 'creating':
        return 'loading';
      case 'error':
        return 'alert-circle';
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
          return formatDistance(sectionDistance, isMetric);
        }
        return t('maps.sectionSelected' as never);
      case 'creating':
        return t('common.creating' as never);
      case 'error':
        return error?.message || t('routes.sectionCreationFailed' as never);
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

  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const pillStyle = isDark ? { backgroundColor: darkColors.surfaceOverlay } : null;
  const ruleStyle = isDark ? { borderTopColor: darkColors.border } : null;
  const mutedText = { color: palette.textSecondary };
  const detailsStyle = isDark ? { backgroundColor: colorWithOpacity(ink.white, 0.06) } : null;

  const isComplete = state === 'complete';
  const isCreating = state === 'creating';
  const isError = state === 'error';
  const hasSelection = startIndex !== null;

  // The icon's fill and the line's text tone. Both used to be the one fill, so
  // the line read at 1.47:1 on a pill that is 95 per cent white.
  const statusTone = ((): SizeTone => {
    if (isError) return { fill: palette.error, text: palette.errorDeep };
    if (isCreating) return sectionSizeTone(null, isDark);
    if (isComplete) return sectionSizeTone(sectionPointCount, isDark);
    return sectionSizeTone(null, isDark);
  })();
  const sizeWarning =
    isComplete && sectionPointCount !== null && sectionPointCount >= 5000
      ? t('routes.largeSectionPerformanceWarning')
      : null;

  // Auto-expand on error to show details
  const shouldExpand = expanded || isError;

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* Compact bottom bar */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        {/* Cancel/Retry button */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={isError ? t('common.retry') : t('common.cancel')}
          style={[styles.iconButton, isError ? styles.retryButton : styles.cancelButton]}
          onPress={isError && onDismissError ? onDismissError : onCancel}
          activeOpacity={0.8}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons
            name={isError ? 'refresh' : 'close'}
            size={22}
            color={colors.textOnDark}
          />
        </TouchableOpacity>

        {/* Center status pill - expandable */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ expanded: shouldExpand, disabled: isCreating }}
          style={[
            styles.statusPill,
            pillStyle,
            shouldExpand && styles.statusPillExpanded,
            isError && [styles.statusPillError, { borderColor: palette.error }],
          ]}
          onPress={toggleExpanded}
          activeOpacity={0.9}
          disabled={isCreating}
        >
          <View style={styles.statusRow}>
            {isCreating ? (
              <ActivityIndicator size="small" color={statusTone.fill} />
            ) : (
              <MaterialCommunityIcons name={getStatusIcon()} size={18} color={statusTone.fill} />
            )}
            <Text
              style={[styles.statusText, { color: statusTone.text }]}
              numberOfLines={isError ? 2 : 1}
            >
              {getStatusText()}
            </Text>
            {!isCreating && (hasSelection || isComplete || isError) && (
              <MaterialCommunityIcons
                name={shouldExpand ? 'chevron-down' : 'chevron-up'}
                size={16}
                color={palette.textSecondary}
              />
            )}
          </View>

          {/* Error details - expanded */}
          {shouldExpand && isError && error && (
            <View style={[styles.expandedContent, ruleStyle]}>
              {/* Technical details toggle */}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showTechnicalDetails }}
                style={pressable(styles.technicalToggle)}
                onPress={() => setShowTechnicalDetails(!showTechnicalDetails)}
                android_ripple={pressRipple}
              >
                <MaterialCommunityIcons
                  name="bug-outline"
                  size={14}
                  color={palette.textSecondary}
                />
                <Text style={[styles.technicalToggleText, mutedText]}>
                  {showTechnicalDetails
                    ? t('common.hideDetails' as never)
                    : t('common.showDetails' as never)}
                </Text>
                <MaterialCommunityIcons
                  name={showTechnicalDetails ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={palette.textSecondary}
                />
              </Pressable>

              {showTechnicalDetails && (
                <View style={[styles.technicalDetails, detailsStyle]}>
                  {error.technicalDetails && (
                    <View style={styles.detailRow}>
                      <MaterialCommunityIcons
                        name="code-tags"
                        size={14}
                        color={palette.textSecondary}
                      />
                      <Text style={[styles.technicalText, mutedText]} selectable>
                        {error.technicalDetails}
                      </Text>
                    </View>
                  )}
                  {error.activityId && (
                    <View style={styles.detailRow}>
                      <MaterialCommunityIcons
                        name="identifier"
                        size={14}
                        color={palette.textSecondary}
                      />
                      <Text style={[styles.technicalText, mutedText]} selectable>
                        ID: {error.activityId}
                      </Text>
                    </View>
                  )}
                  {error.indices && (
                    <View style={styles.detailRow}>
                      <MaterialCommunityIcons
                        name="arrow-expand-horizontal"
                        size={14}
                        color={palette.textSecondary}
                      />
                      <Text style={[styles.technicalText, mutedText]}>
                        Range: {error.indices.start} → {error.indices.end}
                      </Text>
                    </View>
                  )}
                  <Text style={[styles.helpText, mutedText]}>
                    {t('routes.shareDetailsWithDeveloper' as never)}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Expanded details - normal selection */}
          {shouldExpand && hasSelection && !isError && (
            <View style={[styles.expandedContent, ruleStyle]}>
              {getProgress() && (
                <View style={styles.detailRow}>
                  <MaterialCommunityIcons name="percent" size={14} color={palette.textSecondary} />
                  <Text style={[styles.detailText, mutedText]}>{getProgress()}</Text>
                </View>
              )}
              {sectionPointCount !== null && (
                <View style={styles.detailRow}>
                  <MaterialCommunityIcons
                    name="map-marker-multiple"
                    size={14}
                    color={palette.textSecondary}
                  />
                  <Text style={[styles.detailText, mutedText]}>
                    {t('routes.pointCountHint', { count: sectionPointCount })}
                  </Text>
                </View>
              )}
              {sizeWarning && (
                <View style={styles.warningRow}>
                  <MaterialCommunityIcons name="alert-outline" size={14} color={statusTone.fill} />
                  <Text style={[styles.detailText, { color: statusTone.text }]}>{sizeWarning}</Text>
                </View>
              )}
              {/* Reset option in expanded view */}
              <Pressable
                accessibilityRole="button"
                style={pressable(styles.resetRow)}
                onPress={onReset}
                android_ripple={pressRipple}
              >
                <MaterialCommunityIcons name="refresh" size={14} color={palette.primary} />
                <Text style={[styles.resetText, { color: palette.linkTeal }]}>
                  {t('common.reset' as never)}
                </Text>
              </Pressable>
            </View>
          )}
        </TouchableOpacity>

        {/* Create button - only when complete, or cancel on error */}
        {isComplete ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('routes.createSection')}
            style={[styles.iconButton, styles.confirmButton]}
            onPress={onConfirm}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialCommunityIcons name="check" size={22} color={colors.textOnDark} />
          </TouchableOpacity>
        ) : isError ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
            style={[styles.iconButton, styles.cancelButton]}
            onPress={onCancel}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialCommunityIcons name="close" size={22} color={colors.textOnDark} />
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
    ...StyleSheet.absoluteFill,
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
    borderRadius: layout.borderRadiusFull,
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
  retryButton: {
    backgroundColor: colors.primary,
  },
  confirmButton: {
    backgroundColor: colors.success,
  },
  statusPill: {
    flex: 1,
    backgroundColor: colorWithOpacity(ink.white, 0.95),
    borderRadius: layout.borderRadiusFull,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
    ...shadows.elevated,
  },
  statusPillExpanded: {
    borderRadius: layout.borderRadius,
  },
  statusPillError: {
    borderWidth: 1,
    borderColor: colors.error,
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
    flexShrink: 1,
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
    alignItems: 'flex-start',
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
    fontWeight: '600',
  },
  technicalToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  technicalToggleText: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
  },
  technicalDetails: {
    backgroundColor: colorWithOpacity(ink.black, 0.03),
    borderRadius: layout.borderRadiusXs,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  technicalText: {
    ...typography.caption,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    flex: 1,
  },
  helpText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});
