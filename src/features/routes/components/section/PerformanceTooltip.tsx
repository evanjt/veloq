/**
 * Tooltip shown below the section scatter chart when a point is selected.
 *
 * Displays the activity name, date, section time, pace/speed delta vs PR,
 * and exposes the reference / exclude / include controls. Tapping the row
 * navigates to the activity detail screen. The controls are drawn inside the
 * row's own button, so a screen reader is offered them as actions on the row.
 */

import { useMetricSystem } from '@/shared/app';
import React from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { tapTo } from '@/shared/app/navigation';
import {
  formatPace,
  formatSpeed,
  formatDuration,
  formatPower,
  formatPerformanceDelta,
  formatShortDateWithYear,
} from '@/shared/format/format';
import { colors, darkColors, layout, typography, spacing, verdictColor } from '@/theme';
import type { PerformanceDataPoint } from '@/types';
import { assistiveActions, pressable, pressRipple, type AssistiveAction } from '@/shared/ui';

/** Scatter chart point - adds the computed X coordinate to the base record. */
type ChartPoint = PerformanceDataPoint & { x: number };

export interface PerformanceTooltipProps {
  /** The point currently selected by tap/scrub, or null when nothing is selected. */
  selectedPoint: ChartPoint | null;
  isDark: boolean;
  /** When true, display pace instead of speed for the selected point. */
  showPace: boolean;
  /** Accent color for the speed value in "forward" direction. */
  activityColor: string;
  /** Selected reference activity id (shows filled star when matched). */
  referenceActivityId?: string | undefined;
  onSetAsReference?: ((activityId: string) => void) | undefined;
  onExcludeActivity?: ((activityId: string) => void) | undefined;
  onIncludeActivity?: ((activityId: string) => void) | undefined;
  /** Every time stream is read, so the best point is the record. Absent means settled. */
  recordsSettled?: boolean | undefined;
  /** Called when the exclude/include buttons are tapped (to clear local selection). */
  onClearSelection: () => void;
}

export function PerformanceTooltip({
  selectedPoint,
  isDark,
  showPace,
  activityColor,
  referenceActivityId,
  onSetAsReference,
  onExcludeActivity,
  onIncludeActivity,
  recordsSettled = true,
  onClearSelection,
}: PerformanceTooltipProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();

  const formatSpeedValue = (speed: number) =>
    showPace ? formatPace(speed, isMetric) : formatSpeed(speed, isMetric);

  if (!selectedPoint) {
    return (
      <View style={styles.tooltipContainer}>
        <View style={styles.tooltipPlaceholder}>
          <Text style={[styles.chartHint, isDark && styles.textSecondary]}>
            {t('sections.scrubHint')}
          </Text>
        </View>
      </View>
    );
  }

  const delta = formatPerformanceDelta({
    isMetric,
    isBest: selectedPoint.isBest === true,
    showPace,
    currentSpeed: selectedPoint.speed,
    bestSpeed: selectedPoint.bestSpeed,
    timeDelta:
      selectedPoint.sectionTime != null && selectedPoint.bestTime != null
        ? selectedPoint.sectionTime - selectedPoint.bestTime
        : undefined,
  });

  const activityId = selectedPoint.activityId;
  const setReference =
    onSetAsReference && !selectedPoint.isExcluded ? () => onSetAsReference(activityId) : undefined;
  const include =
    selectedPoint.isExcluded && onIncludeActivity
      ? () => {
          onIncludeActivity(activityId);
          onClearSelection();
        }
      : undefined;
  const exclude =
    !selectedPoint.isExcluded && onExcludeActivity
      ? () => {
          onExcludeActivity(activityId);
          onClearSelection();
        }
      : undefined;

  const avgPower = selectedPoint.avgPower;
  const power =
    avgPower != null && Number.isFinite(avgPower) && avgPower > 0 ? formatPower(avgPower) : null;
  const rowLabel = [
    recordsSettled && selectedPoint.isBest ? t('sections.legendPr') : null,
    selectedPoint.activityName,
    formatShortDateWithYear(selectedPoint.date),
    selectedPoint.sectionTime != null ? formatDuration(selectedPoint.sectionTime) : null,
    power,
    delta.deltaDisplay,
    formatSpeedValue(selectedPoint.speed),
  ]
    .filter((part): part is string => !!part)
    .join(', ');

  const rowActions: AssistiveAction[] = [];
  if (setReference) {
    rowActions.push({
      name: 'setReference',
      label: t('sections.setAsReference'),
      run: setReference,
    });
  }
  if (include) {
    rowActions.push({ name: 'include', label: t('sections.includeActivity'), run: include });
  } else if (exclude) {
    rowActions.push({ name: 'exclude', label: t('sections.excludeActivity'), run: exclude });
  }

  return (
    <View style={styles.tooltipContainer}>
      <Pressable
        style={pressable([styles.selectedTooltip, isDark && styles.selectedTooltipDark])}
        accessibilityRole="button"
        accessibilityLabel={rowLabel}
        {...assistiveActions(rowActions)}
        onPress={() => tapTo(`/activity/${activityId}`)}
        android_ripple={pressRipple}
      >
        <View style={styles.tooltipLeft}>
          <View style={styles.tooltipNameRow}>
            {recordsSettled && selectedPoint.isBest && (
              <>
                <MaterialCommunityIcons
                  name="trophy"
                  size={13}
                  color={isDark ? darkColors.chartGoldMark : colors.chartGoldMark}
                  style={{ marginRight: spacing.xs }}
                />
                {/* The trophy was the whole message, and gold on white is
                    1.89:1. The word is what carries it. */}
                <Text style={[styles.prTag, isDark && styles.prTagDark]}>
                  {t('sections.legendPr')}
                </Text>
              </>
            )}
            <Text style={[styles.tooltipName, isDark && styles.textLight]} numberOfLines={1}>
              {selectedPoint.activityName}
            </Text>
            {(selectedPoint.lapCount ?? 0) > 1 && (
              <View style={styles.lapBadge}>
                <Text style={styles.lapBadgeText}>
                  {t('units.times', { value: selectedPoint.lapCount })}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.tooltipMeta}>
            <Text style={[styles.tooltipDate, isDark && styles.textSecondary]}>
              {formatShortDateWithYear(selectedPoint.date)}
            </Text>
            {selectedPoint.sectionTime != null && (
              <Text style={[styles.tooltipDate, isDark && styles.textSecondary]}>
                {' \u00b7 '}
                {formatDuration(selectedPoint.sectionTime)}
              </Text>
            )}
            {power && (
              <Text style={[styles.tooltipDate, isDark && styles.textSecondary]}>
                {' \u00b7 '}
                {power}
              </Text>
            )}
            {delta.deltaDisplay && (
              <Text
                style={[
                  styles.tooltipDelta,
                  {
                    color: verdictColor(delta.isFaster ? 'positive' : 'negative', isDark),
                  },
                ]}
              >
                {' \u00b7 '}
                {delta.deltaDisplay}
              </Text>
            )}
            {selectedPoint.direction === 'reverse' && (
              <View style={styles.reverseBadge}>
                <MaterialCommunityIcons
                  name="swap-horizontal"
                  size={10}
                  color={colors.reverseDirection}
                />
              </View>
            )}
          </View>
        </View>
        <View style={styles.tooltipRight}>
          <Text
            style={[
              styles.tooltipSpeed,
              {
                color:
                  selectedPoint.direction === 'reverse' ? colors.reverseDirection : activityColor,
              },
            ]}
          >
            {formatSpeedValue(selectedPoint.speed)}
          </Text>
          {setReference && (
            <Pressable
              onPress={setReference}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={pressable(styles.referenceButton)}
              accessibilityLabel={t('sections.setAsReference')}
              accessibilityRole="button"
              android_ripple={pressRipple}
            >
              <MaterialCommunityIcons
                name={selectedPoint.activityId === referenceActivityId ? 'star' : 'star-outline'}
                size={18}
                color={
                  selectedPoint.activityId === referenceActivityId
                    ? colors.primary
                    : isDark
                      ? darkColors.textSecondary
                      : colors.textSecondary
                }
              />
            </Pressable>
          )}
          {include ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('sections.includeActivity')}
              onPress={include}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={pressable(styles.excludeButton)}
              android_ripple={pressRipple}
            >
              <MaterialCommunityIcons name="undo" size={16} color={colors.primary} />
            </Pressable>
          ) : (
            exclude && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('sections.excludeActivity')}
                onPress={exclude}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={pressable(styles.excludeButton)}
                android_ripple={pressRipple}
              >
                <MaterialCommunityIcons
                  name="close-circle-outline"
                  size={16}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
              </Pressable>
            )
          )}
          <MaterialCommunityIcons
            name="chevron-right"
            size={14}
            color={isDark ? darkColors.textSecondary : colors.border}
          />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  tooltipContainer: {
    minHeight: 52,
    paddingHorizontal: spacing.smPlus,
    paddingBottom: spacing.smPlus,
  },
  tooltipPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 44,
  },
  chartHint: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  selectedTooltip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    padding: spacing.sm,
    borderRadius: layout.borderRadiusSm,
  },
  selectedTooltipDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  tooltipLeft: {
    flex: 1,
    marginRight: spacing.sm,
  },
  tooltipNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tooltipName: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xxs,
    flex: 1,
  },
  prTag: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    color: colors.chartGoldText,
    marginRight: spacing.xs,
  },
  prTagDark: {
    color: darkColors.chartGoldText,
  },
  lapBadge: {
    backgroundColor: colors.textSecondary + '20',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    borderRadius: layout.borderRadiusXs,
    marginLeft: spacing.xs,
  },
  lapBadgeText: {
    fontSize: typography.micro.fontSize,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  tooltipDelta: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
  },
  tooltipMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  tooltipDate: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  reverseBadge: {
    padding: spacing.xxs,
  },
  tooltipRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  referenceButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xxs,
  },
  excludeButton: {
    padding: spacing.xxs,
    marginLeft: spacing.xs,
  },
  tooltipSpeed: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
});
