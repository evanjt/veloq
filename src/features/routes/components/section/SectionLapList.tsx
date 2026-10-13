/**
 * Laps of the activities that crossed the section more than once. Collapsed,
 * one row per activity for the one holding the record lap and the most recent
 * few. Show all opens every lap, each with its own exclude. An excluded lap
 * stays listed, muted, with an undo. The record lap is the one the engine
 * names, and carries the trophy.
 */

import React, { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { formatDuration, formatPower, formatFullDate } from '@/shared/format/format';
import { Button, Card, composeAccessibilityLabel } from '@/shared/ui';
import { tapTo } from '@/shared/app/navigation';
import { colors, darkColors, spacing, typography, layout, slopToMinTapTarget } from '@/theme';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';

export interface SectionLapListProps {
  isDark: boolean;
  initiallyExpanded?: boolean;
  /** Every lap of each activity, the excluded ones flagged. */
  records: SectionPerformanceRecord[];
  onExcludeLap: (activityId: string, startIndex: number) => void;
  onIncludeLap: (activityId: string, startIndex: number) => void;
}

const RECENT_ACTIVITIES = 3;

const pillHitSlop = slopToMinTapTarget(typography.caption.lineHeight + spacing.xxs * 2);

function bestLapTime(r: SectionPerformanceRecord): number | null {
  let best: number | null = null;
  for (const lap of r.laps) {
    if (!lap.excluded && (best === null || lap.time < best)) best = lap.time;
  }
  return best;
}

function holdsRecord(r: SectionPerformanceRecord): boolean {
  return r.laps.some((lap) => lap.isRecord);
}

/** The activities holding a record lap and the most recent, newest first. */
function collapsedActivities(lapped: SectionPerformanceRecord[]): SectionPerformanceRecord[] {
  const recent = [...lapped].sort((a, b) => b.activityDate.getTime() - a.activityDate.getTime());
  const keep = new Set(recent.slice(0, RECENT_ACTIVITIES));
  for (const r of lapped) {
    if (holdsRecord(r)) keep.add(r);
  }
  return recent.filter((r) => keep.has(r));
}

function RecordMark({ testID, isDark, label }: { testID: string; isDark: boolean; label: string }) {
  return (
    <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={label}>
      <MaterialCommunityIcons
        name="trophy"
        size={12}
        color={isDark ? darkColors.chartGoldMark : colors.chartGoldMark}
      />
    </View>
  );
}

export function SectionLapList({
  isDark,
  initiallyExpanded = false,
  records,
  onExcludeLap,
  onIncludeLap,
}: SectionLapListProps) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(initiallyExpanded);
  const lapped = records.filter((r) => r.laps.length > 1);
  if (lapped.length === 0) return null;

  return (
    <Card variant="flat" testID="section-lap-list">
      <View style={styles.header}>
        <MaterialCommunityIcons
          name="repeat"
          size={18}
          color={isDark ? darkColors.textPrimary : colors.textPrimary}
        />
        <Text accessibilityRole="header" style={[styles.title, isDark && styles.textDark]}>
          {t('sections.laps')}
        </Text>
      </View>
      {!showAll
        ? collapsedActivities(lapped).map((r) => {
            const best = bestLapTime(r);
            const date = formatFullDate(r.activityDate);
            const record = holdsRecord(r);
            const bestLap =
              best !== null ? t('sections.bestLapValue', { time: formatDuration(best) }) : null;
            const lapCount = `×${r.laps.length}`;
            return (
              <Pressable
                key={r.activityId}
                style={pressable(styles.summaryRow)}
                testID={`section-lap-summary-${r.activityId}`}
                accessibilityRole="button"
                accessibilityLabel={composeAccessibilityLabel(
                  r.activityName,
                  date,
                  record && t('a11y.recordLap'),
                  bestLap,
                  t('a11y.laps', { n: r.laps.length })
                )}
                onPress={() => tapTo(`/activity/${r.activityId}`)}
                android_ripple={pressRipple}
              >
                <View style={styles.summaryName}>
                  <Text style={[styles.activityName, isDark && styles.textDark]} numberOfLines={1}>
                    {r.activityName}
                  </Text>
                  <Text style={[styles.activityDate, isDark && styles.textSecondaryDark]}>
                    {date}
                  </Text>
                </View>
                {record ? (
                  <RecordMark
                    testID={`section-lap-record-${r.activityId}`}
                    isDark={isDark}
                    label={t('a11y.recordLap')}
                  />
                ) : null}
                {best !== null ? (
                  <Text
                    style={[styles.lapTime, isDark && styles.textDark]}
                    numberOfLines={1}
                    accessibilityLabel={bestLap ?? undefined}
                  >
                    {formatDuration(best)}
                  </Text>
                ) : null}
                <Text
                  style={[styles.lapCount, isDark && styles.textSecondaryDark]}
                  numberOfLines={1}
                >
                  {lapCount}
                </Text>
              </Pressable>
            );
          })
        : lapped.map((r) => (
            <View key={r.activityId} style={styles.activity}>
              <Text style={[styles.activityName, isDark && styles.textDark]} numberOfLines={1}>
                {r.activityName}
              </Text>
              <Text style={[styles.activityDate, isDark && styles.textSecondaryDark]}>
                {formatFullDate(r.activityDate)}
              </Text>
              {[...r.laps]
                .sort((a, b) => a.startIndex - b.startIndex)
                .map((lap, i) => {
                  const excluded = lap.excluded;
                  const id = `${lap.activityId}-${lap.startIndex}`;
                  return (
                    <View
                      key={lap.id}
                      style={[styles.lapRow, excluded && styles.lapRowExcluded]}
                      testID={`section-lap-row-${id}`}
                    >
                      <Text style={[styles.lapLabel, isDark && styles.textDark]}>
                        {t('sections.lap', { n: i + 1 })}
                        {lap.direction === 'reverse' ? ` · ${t('sections.reverse')}` : ''}
                      </Text>
                      {lap.isRecord ? (
                        <RecordMark
                          testID={`section-lap-record-${id}`}
                          isDark={isDark}
                          label={t('a11y.recordLap')}
                        />
                      ) : null}
                      <Text style={[styles.lapTime, isDark && styles.textDark]}>
                        {formatDuration(lap.time)}
                      </Text>
                      {lap.avgPower != null && Number.isFinite(lap.avgPower) && lap.avgPower > 0 ? (
                        <Text style={[styles.lapPower, isDark && styles.textSecondaryDark]}>
                          {formatPower(lap.avgPower)}
                        </Text>
                      ) : null}
                      {excluded ? (
                        <Pressable
                          testID={`section-lap-undo-${id}`}
                          style={pressable([styles.pill, isDark && styles.pillDark])}
                          accessibilityRole="button"
                          accessibilityLabel={t('sections.undoExcludeLap', {
                            n: i + 1,
                          })}
                          onPress={() => onIncludeLap(lap.activityId, lap.startIndex)}
                          hitSlop={pillHitSlop}
                          android_ripple={pressRipple}
                        >
                          <Text style={[styles.pillMuted, isDark && styles.textSecondaryDark]}>
                            {t('sections.lapExcluded')}
                          </Text>
                          <Text style={[styles.pillText, isDark && { color: darkColors.linkTeal }]}>
                            {t('sections.undoExclude')}
                          </Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          testID={`section-lap-exclude-${id}`}
                          style={pressable([styles.pill, isDark && styles.pillDark])}
                          accessibilityRole="button"
                          accessibilityLabel={t('sections.excludeLapNumber', {
                            n: i + 1,
                          })}
                          onPress={() => onExcludeLap(lap.activityId, lap.startIndex)}
                          hitSlop={pillHitSlop}
                          android_ripple={pressRipple}
                        >
                          <MaterialCommunityIcons
                            name="eye-off-outline"
                            size={12}
                            color={colors.primary}
                          />
                          <Text style={[styles.pillText, isDark && { color: darkColors.linkTeal }]}>
                            {t('sections.excludeLap')}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  );
                })}
            </View>
          ))}
      <Button
        testID={showAll ? 'section-lap-show-fewer' : 'section-lap-show-all'}
        label={showAll ? t('sections.showFewerLaps') : t('sections.showAllLaps')}
        variant="ghost"
        size="sm"
        onPress={() => setShowAll((v) => !v)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: { ...typography.cardTitle, color: colors.textPrimary },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: layout.minTapTarget,
    paddingVertical: spacing.xs,
  },
  summaryName: { flex: 1 },
  lapCount: { ...typography.caption, color: colors.textSecondary },
  activity: { marginTop: spacing.xs },
  activityName: { ...typography.bodySmall, color: colors.textPrimary },
  activityDate: { ...typography.caption, color: colors.textSecondary },
  lapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  lapRowExcluded: { opacity: 0.6 },
  lapLabel: { ...typography.bodySmall, color: colors.textPrimary, flex: 1 },
  lapTime: { ...typography.metricValue, color: colors.textPrimary },
  lapPower: { ...typography.caption, color: colors.textSecondary },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: layout.borderRadiusLg,
    backgroundColor: colors.background,
  },
  pillDark: { backgroundColor: darkColors.surfaceElevated },
  pillText: { ...typography.caption, color: colors.linkTeal },
  pillMuted: { ...typography.caption, color: colors.textSecondary },
  textDark: { color: darkColors.textPrimary },
  textSecondaryDark: { color: darkColors.textSecondary },
});
