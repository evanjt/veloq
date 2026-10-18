/**
 * Overlay component for creating custom sections on an activity map.
 * Compact bottom bar design that maximizes map visibility.
 */

import React, { useState } from 'react';
import { Pressable, View, StyleSheet, Text } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  colors,
  colorWithOpacity,
  controlHeight,
  darkColors,
  iconSize,
  ink,
  layers,
  layout,
  opacity,
  raised,
  slopToMinTapTarget,
  spacing,
  stroke,
  typography,
} from '@/theme';
import { sectionSizeTone, type SizeTone } from '@/features/maps/lib/sectionSizeTone';
import { formatDistance } from '@/shared/format/format';
import { useMetricSystem, useTheme } from '@/shared/app';
import { Button, IconButton, pressable, pressRipple, Spinner } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { useAnnounceOnAppear } from '@/shared/ui/useAnnounceOnAppear';
import { formatPercent } from '@/shared/format';

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
    const startPercent = formatPercent((startIndex / coordinateCount) * 100);
    if (endIndex === null) {
      return startPercent;
    }
    const endPercent = formatPercent((endIndex / coordinateCount) * 100);
    return `${startPercent} - ${endPercent}`;
  };

  const toggleExpanded = () => {
    setExpanded(!expanded);
  };

  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const pillStyle = isDark ? { backgroundColor: darkColors.surfaceRaised } : null;
  const ruleStyle = isDark ? { borderTopColor: darkColors.border } : null;
  const mutedText = { color: palette.textSecondary };
  const detailsStyle = isDark
    ? { backgroundColor: colorWithOpacity(ink.white, opacity.tint1) }
    : null;

  const isComplete = state === 'complete';
  const isCreating = state === 'creating';
  const isError = state === 'error';
  const hasSelection = startIndex !== null;

  // The icon's fill and the line's text tone. Both used to be the one fill, so
  // the line read at 1.47:1 on a pill that is 95 per cent white.
  const statusTone = ((): SizeTone => {
    if (isError) return { fill: palette.dangerFill, text: palette.errorText };
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

  // Each step's prompt is spoken as the step begins. A finished selection
  // shows only its distance, so the spoken line says what the distance is of.
  const statusText = getStatusText();
  const statusLabel =
    isComplete && sectionDistance !== null
      ? `${t('maps.sectionSelected' as never)}, ${statusText}`
      : statusText;
  useAnnounceOnAppear(statusLabel);

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* Compact bottom bar */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        {/* Cancel/Retry button */}
        <IconButton
          accessibilityLabel={isError ? t('common.retry') : t('common.cancel')}
          style={[styles.iconButton, raised('elevated', isDark)]}
          variant={isError ? 'primary' : 'destructive'}
          onPress={isError && onDismissError ? onDismissError : onCancel}
        >
          <Icon
            name={isError ? 'refresh' : 'close'}
            size={iconSize.lg}
            color={isError ? colors.textOnFill : colors.textOnFill}
          />
        </IconButton>

        {/* Center status pill - expandable */}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: shouldExpand, disabled: isCreating }}
          hitSlop={slopToMinTapTarget(STATUS_PILL_MIN_HEIGHT)}
          style={pressable([
            styles.statusPill,
            raised('elevated', isDark),
            pillStyle,
            shouldExpand && styles.statusPillExpanded,
            isError && [styles.statusPillError, { borderColor: palette.errorText }],
          ])}
          onPress={toggleExpanded}
          android_ripple={pressRipple}
          disabled={isCreating}
        >
          <View style={styles.statusRow}>
            {isCreating ? (
              <Spinner inControl color={statusTone.fill} />
            ) : (
              <Icon name={getStatusIcon()} size={iconSize.md} color={statusTone.fill} />
            )}
            <Text
              style={[styles.statusText, { color: statusTone.text }]}
              numberOfLines={isError ? 2 : 1}
              accessibilityLabel={statusLabel}
              accessibilityLiveRegion="polite"
            >
              {statusText}
            </Text>
            {!isCreating && (hasSelection || isComplete || isError) ? (
              <Icon
                name={shouldExpand ? 'chevron-down' : 'chevron-up'}
                size={iconSize.sm}
                color={palette.textSecondary}
              />
            ) : null}
          </View>

          {/* Error details - expanded */}
          {shouldExpand && isError && error ? (
            <Animated.View entering={FadeIn} style={[styles.expandedContent, ruleStyle]}>
              {/* Technical details toggle */}
              <Button
                testID="section-creation-technical-toggle"
                label={
                  showTechnicalDetails
                    ? t('common.hideDetails' as never)
                    : t('common.showDetails' as never)
                }
                variant="ghost"
                size="sm"
                expanded={showTechnicalDetails}
                style={styles.technicalToggle}
                onPress={() => setShowTechnicalDetails(!showTechnicalDetails)}
              />

              {showTechnicalDetails ? (
                <View style={[styles.technicalDetails, detailsStyle]}>
                  {error.technicalDetails ? (
                    <View style={styles.detailRow}>
                      <Icon name="code-tags" size={iconSize.sm} color={palette.textSecondary} />
                      <Text style={[styles.technicalText, mutedText]} selectable>
                        {error.technicalDetails}
                      </Text>
                    </View>
                  ) : null}
                  {error.activityId ? (
                    <View style={styles.detailRow}>
                      <Icon name="identifier" size={iconSize.sm} color={palette.textSecondary} />
                      <Text style={[styles.technicalText, mutedText]} selectable>
                        {t('routes.errorDetailId', { id: error.activityId })}
                      </Text>
                    </View>
                  ) : null}
                  {error.indices ? (
                    <View style={styles.detailRow}>
                      <Icon
                        name="arrow-expand-horizontal"
                        size={iconSize.sm}
                        color={palette.textSecondary}
                      />
                      <Text style={[styles.technicalText, mutedText]}>
                        {t('routes.errorDetailRange', {
                          start: error.indices.start,
                          end: error.indices.end,
                        })}
                      </Text>
                    </View>
                  ) : null}
                  <Text style={[styles.helpText, mutedText]}>
                    {t('routes.shareDetailsWithDeveloper' as never)}
                  </Text>
                </View>
              ) : null}
            </Animated.View>
          ) : null}

          {/* Expanded details - normal selection */}
          {shouldExpand && hasSelection && !isError ? (
            <Animated.View entering={FadeIn} style={[styles.expandedContent, ruleStyle]}>
              {getProgress() && (
                <View style={styles.detailRow}>
                  <Icon name="percent" size={iconSize.sm} color={palette.textSecondary} />
                  <Text style={[styles.detailText, mutedText]}>{getProgress()}</Text>
                </View>
              )}
              {sectionPointCount !== null && (
                <View style={styles.detailRow}>
                  <Icon
                    name="map-marker-multiple"
                    size={iconSize.sm}
                    color={palette.textSecondary}
                  />
                  <Text style={[styles.detailText, mutedText]}>
                    {t('routes.pointCountHint', { count: sectionPointCount })}
                  </Text>
                </View>
              )}
              {sizeWarning ? (
                <View style={styles.warningRow}>
                  <Icon name="alert-outline" size={iconSize.sm} color={statusTone.fill} />
                  <Text style={[styles.detailText, { color: statusTone.text }]}>{sizeWarning}</Text>
                </View>
              ) : null}
              {/* Reset option in expanded view */}
              <Pressable
                accessibilityRole="button"
                style={pressable(styles.resetRow)}
                hitSlop={slopToMinTapTarget(EXPANDED_ROW_HEIGHT)}
                onPress={onReset}
                android_ripple={pressRipple}
              >
                <Icon name="refresh" size={iconSize.sm} color={palette.actionPrimary} />
                <Text style={[styles.resetText, { color: palette.actionLink }]}>
                  {t('common.reset' as never)}
                </Text>
              </Pressable>
            </Animated.View>
          ) : null}
        </Pressable>

        {/* Create button - only when complete, or cancel on error */}
        {isComplete ? (
          <IconButton
            accessibilityLabel={t('routes.createSection')}
            style={[styles.iconButton, raised('elevated', isDark)]}
            variant="primary"
            onPress={onConfirm}
          >
            <Icon name="check" size={iconSize.lg} color={colors.textOnFill} />
          </IconButton>
        ) : isError ? (
          <IconButton
            accessibilityLabel={t('common.cancel')}
            style={[styles.iconButton, raised('elevated', isDark)]}
            variant="destructive"
            onPress={onCancel}
          >
            <Icon name="close" size={iconSize.lg} color={colors.textOnFill} />
          </IconButton>
        ) : (
          <View style={styles.iconButtonPlaceholder} />
        )}
      </View>
    </View>
  );
}

// The pill sits level with the icon buttons beside it.
const STATUS_PILL_MIN_HEIGHT = controlHeight.button;
// A caption line inside the padding of the expanded card's two text controls.
const EXPANDED_ROW_HEIGHT = typography.caption.lineHeight + 2 * spacing.xs;

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    zIndex: layers.overlay,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  // Drawn in IconButton's own square, which its hit slop lifts to the minimum.
  iconButton: {
    borderRadius: layout.borderRadiusFull,
  },
  iconButtonPlaceholder: {
    width: controlHeight.button,
    height: controlHeight.button,
  },
  statusPill: {
    flex: 1,
    backgroundColor: colorWithOpacity(ink.white, 0.95),
    borderRadius: layout.borderRadiusFull,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: STATUS_PILL_MIN_HEIGHT,
    justifyContent: 'center',
  },
  statusPillExpanded: {
    borderRadius: layout.borderRadius,
  },
  statusPillError: {
    borderWidth: stroke.one,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  statusText: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  expandedContent: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: stroke.hairline,
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
  },
  resetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
    minHeight: EXPANDED_ROW_HEIGHT,
  },
  resetText: {
    ...typography.captionBold,
  },
  // The toggle sits at the start of the details it opens, not centred under the status.
  technicalToggle: {
    alignSelf: 'flex-start',
  },
  technicalDetails: {
    backgroundColor: colorWithOpacity(ink.black, opacity.tint1),
    borderRadius: layout.borderRadiusXs,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  technicalText: {
    ...typography.caption,
    fontFamily: typography.code.fontFamily,
    fontSize: typography.label.fontSize,
    flex: 1,
  },
  helpText: {
    ...typography.caption,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});
