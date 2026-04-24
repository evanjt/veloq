/**
 * Tooltip shown below the section scatter chart when a point is selected.
 *
 * Displays the activity name, date, section time, pace/speed delta vs PR,
 * and exposes the reference / exclude / include controls. Tapping the row
 * navigates to the activity detail screen.
 *
 * Extracted from SectionScatterChart so the scatter component stays focused
 * on the chart surface.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { navigateTo, formatPace, formatSpeed, formatDuration, formatPerformanceDelta } from '@/lib';
import { formatShortDateWithYear } from '@/lib/charts/dateFormatting';
import { colors, darkColors } from '@/theme';
import type { PerformanceDataPoint } from '@/types';

/** Scatter chart point — adds the computed X coordinate to the base record. */
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
  referenceActivityId?: string;
  onSetAsReference?: (activityId: string) => void;
  onExcludeActivity?: (activityId: string) => void;
  onIncludeActivity?: (activityId: string) => void;
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
  onClearSelection,
}: PerformanceTooltipProps) {
  const { t } = useTranslation();

  const formatSpeedValue = (speed: number) => (showPace ? formatPace(speed) : formatSpeed(speed));

  if (!selectedPoint) {
    return (
      <View style={styles.tooltipContainer}>
        <View style={styles.tooltipPlaceholder}>
          <Text style={[styles.chartHint, isDark && styles.textMuted]}>
            {t('sections.scrubHint')}
          </Text>
        </View>
      </View>
    );
  }

  const delta = formatPerformanceDelta({
    isBest: selectedPoint.isBest === true,
    showPace,
    currentSpeed: selectedPoint.speed,
    bestSpeed: selectedPoint.bestSpeed,
    timeDelta:
      selectedPoint.sectionTime != null && selectedPoint.bestTime != null
        ? selectedPoint.sectionTime - selectedPoint.bestTime
        : undefined,
  });

  return (
    <View style={styles.tooltipContainer}>
      <TouchableOpacity
        style={[styles.selectedTooltip, isDark && styles.selectedTooltipDark]}
        onPress={() => navigateTo(`/activity/${selectedPoint.activityId}`)}
        activeOpacity={0.7}
      >
        <View style={styles.tooltipLeft}>
          <View style={styles.tooltipNameRow}>
            {selectedPoint.isBest && (
              <MaterialCommunityIcons
                name="trophy"
                size={13}
                color={colors.chartGold}
                style={{ marginRight: 3 }}
              />
            )}
            <Text style={[styles.tooltipName, isDark && styles.textLight]} numberOfLines={1}>
              {selectedPoint.activityName}
            </Text>
            {(selectedPoint.lapCount ?? 0) > 1 && (
              <View style={styles.lapBadge}>
                <Text style={styles.lapBadgeText}>{selectedPoint.lapCount}x</Text>
              </View>
            )}
          </View>
          <View style={styles.tooltipMeta}>
            <Text style={[styles.tooltipDate, isDark && styles.textMuted]}>
              {formatShortDateWithYear(selectedPoint.date)}
            </Text>
            {selectedPoint.sectionTime != null && (
              <Text style={[styles.tooltipDate, isDark && styles.textMuted]}>
                {' \u00b7 '}
                {formatDuration(selectedPoint.sectionTime)}
              </Text>
            )}
            {delta.deltaDisplay && (
              <Text
                style={[
                  styles.tooltipDelta,
                  { color: delta.isFaster ? colors.success : colors.error },
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
          {onSetAsReference && !selectedPoint.isExcluded && (
            <TouchableOpacity
              onPress={() => onSetAsReference(selectedPoint.activityId)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={styles.referenceButton}
              accessibilityLabel="Set as reference"
              accessibilityRole="button"
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
            </TouchableOpacity>
          )}
          {selectedPoint.isExcluded && onIncludeActivity ? (
            <TouchableOpacity
              onPress={() => {
                onIncludeActivity(selectedPoint.activityId);
                onClearSelection();
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.excludeButton}
            >
              <MaterialCommunityIcons name="undo" size={16} color={colors.primary} />
            </TouchableOpacity>
          ) : (
            onExcludeActivity &&
            !selectedPoint.isExcluded && (
              <TouchableOpacity
                onPress={() => {
                  onExcludeActivity(selectedPoint.activityId);
                  onClearSelection();
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.excludeButton}
              >
                <MaterialCommunityIcons
                  name="close-circle-outline"
                  size={16}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
              </TouchableOpacity>
            )
          )}
          <MaterialCommunityIcons
            name="chevron-right"
            size={14}
            color={isDark ? darkColors.textMuted : colors.border}
          />
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  tooltipContainer: {
    minHeight: 52,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  tooltipPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 44,
  },
  chartHint: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
  },
  selectedTooltip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    padding: 10,
    borderRadius: 8,
  },
  selectedTooltipDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  tooltipLeft: {
    flex: 1,
    marginRight: 8,
  },
  tooltipNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tooltipName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 1,
    flex: 1,
  },
  lapBadge: {
    backgroundColor: colors.textMuted + '20',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 4,
  },
  lapBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  tooltipDelta: {
    fontSize: 11,
    fontWeight: '600',
  },
  tooltipMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tooltipDate: {
    fontSize: 11,
    color: colors.textMuted,
  },
  reverseBadge: {
    padding: 1,
  },
  tooltipRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  referenceButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  excludeButton: {
    padding: 2,
    marginLeft: 4,
  },
  tooltipSpeed: {
    fontSize: 14,
    fontWeight: '700',
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
});
