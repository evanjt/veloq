/**
 * Tooltip shown below the section scatter chart when a point is selected.
 *
 * Displays the activity name, date, the attempt's figure and its gap to the
 * best in the basis the chart plots on, and exposes the reference / exclude /
 * include controls. Tapping the row navigates to the activity detail screen.
 * The controls are drawn inside the row's own button, so a screen reader is
 * offered them as actions on the row.
 */

import { useMetricSystem } from '@/shared/app';
import React from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { navigateTo } from '@/shared/app/navigation';
import {
  formatDuration,
  formatPower,
  formatPerformanceDelta,
  formatShortDateWithYear,
} from '@/shared/format/format';
import {
  formatAttemptHeadline,
  readsPace,
  type AttemptBasis,
} from '@/features/routes/lib/attemptBasis';
import { directionColour } from '@/features/routes/lib/directionColour';
import {
  colors,
  darkColors,
  iconSize,
  layout,
  type Palette,
  spacing,
  themedStyles,
  typography,
  verdictColor,
  themePalette,
} from '@/theme';
import type { PerformanceDataPoint } from '@/types';
import {
  type AccessibleAction,
  accessibleActions,
  ICON_BUTTON_GAP,
  IconButton,
  pressable,
  pressRipple,
} from '@/shared/ui';
import { Badge } from '@/shared/ui/Badge';
import { Icon } from '@/shared/ui/Icon';
import { NameText } from '@/shared/ui/NameText';

/** Scatter chart point - adds the computed X coordinate to the base record. */
type ChartPoint = PerformanceDataPoint & { x: number };

export interface PerformanceTooltipProps {
  /** The point currently selected by tap/scrub, or null when nothing is selected. */
  selectedPoint: ChartPoint | null;
  isDark: boolean;
  /** What the headline and its gap to the best read as, the basis the chart plots on. */
  basis: AttemptBasis;
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
  basis,
  referenceActivityId,
  onSetAsReference,
  onExcludeActivity,
  onIncludeActivity,
  recordsSettled = true,
  onClearSelection,
}: PerformanceTooltipProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const styles = themedStyles(makeStyles, isDark);

  if (!selectedPoint) {
    return (
      <View style={styles.tooltipContainer}>
        <View style={styles.tooltipPlaceholder}>
          <Text style={styles.chartHint}>{t('sections.scrubHint')}</Text>
        </View>
      </View>
    );
  }

  const delta = formatPerformanceDelta({
    isMetric,
    isBest: selectedPoint.isBest === true,
    showPace: readsPace(basis),
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
    basis !== 'time' && selectedPoint.sectionTime != null
      ? formatDuration(selectedPoint.sectionTime)
      : null,
    power,
    delta.deltaDisplay,
    formatAttemptHeadline(basis, selectedPoint.sectionTime, selectedPoint.speed, isMetric),
  ]
    .filter((part): part is string => !!part)
    .join(', ');

  const rowActions: AccessibleAction[] = [];
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
        style={pressable(styles.selectedTooltip)}
        accessibilityRole="button"
        accessibilityLabel={rowLabel}
        {...accessibleActions(rowActions)}
        onPress={() => navigateTo(`/activity/${activityId}`)}
        android_ripple={pressRipple}
      >
        <View style={styles.tooltipLeft}>
          <View style={styles.tooltipNameRow}>
            {recordsSettled && selectedPoint.isBest ? (
              <>
                <Icon
                  name="trophy"
                  size={iconSize.xs}
                  color={isDark ? darkColors.achievement : colors.achievement}
                  style={{ marginRight: spacing.xs }}
                />
                {/* The trophy was the whole message, and gold on white is
                    1.89:1. The word is what carries it. */}
                <Text style={styles.prTag}>{t('sections.legendPr')}</Text>
              </>
            ) : null}
            <NameText style={styles.tooltipName}>{selectedPoint.activityName}</NameText>
            {(selectedPoint.lapCount ?? 0) > 1 && (
              <Badge
                tone="neutral"
                text={t('units.times', { value: selectedPoint.lapCount })}
                isDark={isDark}
                style={styles.lapBadgePlace}
              />
            )}
          </View>
          <View style={styles.tooltipMeta}>
            <Text style={styles.tooltipDate}>{formatShortDateWithYear(selectedPoint.date)}</Text>
            {basis !== 'time' && selectedPoint.sectionTime != null && (
              <Text style={styles.tooltipDate}>
                {' \u00b7 '}
                {formatDuration(selectedPoint.sectionTime)}
              </Text>
            )}
            {power ? (
              <Text style={styles.tooltipDate}>
                {' \u00b7 '}
                {power}
              </Text>
            ) : null}
            {delta.deltaDisplay ? (
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
            ) : null}
            {selectedPoint.direction === 'reverse' && (
              <View style={styles.reverseBadge}>
                <Icon
                  name="swap-horizontal"
                  size={iconSize.xs}
                  color={directionColour('reverse', isDark)}
                />
              </View>
            )}
          </View>
        </View>
        <View style={styles.tooltipRight}>
          <Text
            testID="performance-tooltip-value"
            style={[
              styles.tooltipSpeed,
              {
                color: directionColour(
                  selectedPoint.direction === 'reverse' ? 'reverse' : 'forward',
                  isDark
                ),
              },
            ]}
          >
            {formatAttemptHeadline(basis, selectedPoint.sectionTime, selectedPoint.speed, isMetric)}
          </Text>
          {setReference ? (
            <IconButton onPress={setReference} accessibilityLabel={t('sections.setAsReference')}>
              <Icon
                name={selectedPoint.activityId === referenceActivityId ? 'star' : 'star-outline'}
                size={iconSize.md}
                color={
                  selectedPoint.activityId === referenceActivityId
                    ? themePalette(isDark).actionPrimary
                    : styles.tooltipDate.color
                }
              />
            </IconButton>
          ) : null}
          {include ? (
            <IconButton accessibilityLabel={t('sections.includeActivity')} onPress={include}>
              <Icon name="undo" size={iconSize.sm} color={themePalette(isDark).actionPrimary} />
            </IconButton>
          ) : (
            exclude && (
              <IconButton accessibilityLabel={t('sections.excludeActivity')} onPress={exclude}>
                <Icon name="eye-off-outline" size={iconSize.sm} color={styles.tooltipDate.color} />
              </IconButton>
            )
          )}
          <Icon name="chevron-right" size={iconSize.sm} color={styles.tooltipDate.color} />
        </View>
      </Pressable>
    </View>
  );
}

const makeStyles = (palette: Palette, isDark: boolean) =>
  StyleSheet.create({
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
      color: palette.textSecondary,
      textAlign: 'center',
    },
    selectedTooltip: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      // The elevated surface is a role only the dark theme has.
      backgroundColor: isDark ? darkColors.surfaceRaised : palette.surfacePage,
      padding: spacing.sm,
      borderRadius: layout.borderRadiusSm,
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
      ...typography.bodyCompactBold,
      color: palette.textPrimary,
      marginBottom: spacing.xxs,
      flex: 1,
    },
    prTag: {
      ...typography.captionBold,
      color: palette.achievementText,
      marginRight: spacing.xs,
    },
    lapBadgePlace: {
      marginLeft: spacing.xs,
    },
    tooltipDelta: {
      ...typography.badge,
    },
    tooltipMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    tooltipDate: {
      fontSize: typography.label.fontSize,
      color: palette.textSecondary,
    },
    reverseBadge: {
      padding: spacing.xxs,
    },
    // The reference and exclude buttons sit side by side.
    tooltipRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: ICON_BUTTON_GAP,
    },
    tooltipSpeed: {
      ...typography.pillValue,
    },
  });
