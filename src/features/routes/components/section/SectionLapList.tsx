/**
 * Laps of the activities that crossed the section more than once. Collapsed,
 * one row per activity for the one holding the best lap and the most recent
 * few. Show all opens every lap, each with its own exclude. An excluded lap
 * stays listed, muted, with an undo.
 */

import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { formatDuration, formatPower, getIntlLocale } from '@/shared/format/format';
import { Button, Card } from '@/shared/ui';
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

/** The activity holding the best lap, then the most recent, newest first. */
function collapsedActivities(lapped: SectionPerformanceRecord[]): SectionPerformanceRecord[] {
  const recent = [...lapped].sort((a, b) => b.activityDate.getTime() - a.activityDate.getTime());
  const keep = new Set(recent.slice(0, RECENT_ACTIVITIES));
  let best: SectionPerformanceRecord | null = null;
  let bestTime = Infinity;
  for (const r of lapped) {
    const time = bestLapTime(r);
    if (time !== null && time < bestTime) {
      best = r;
      bestTime = time;
    }
  }
  if (best) keep.add(best);
  return recent.filter((r) => keep.has(r));
}

export function SectionLapList({
  isDark,
  initiallyExpanded = false,
  records,
  onExcludeLap,
  onIncludeLap,
}: SectionLapListProps) {
  const { t } = useTranslation();
  const locale = getIntlLocale();
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
        <Text style={[styles.title, isDark && styles.textDark]}>{t('sections.laps')}</Text>
      </View>
      {!showAll
        ? collapsedActivities(lapped).map((r) => {
            const best = bestLapTime(r);
            return (
              <View
                key={r.activityId}
                style={styles.summaryRow}
                testID={`section-lap-summary-${r.activityId}`}
              >
                <View style={styles.summaryName}>
                  <Text style={[styles.activityName, isDark && styles.textDark]} numberOfLines={1}>
                    {r.activityName}
                  </Text>
                  <Text style={[styles.activityDate, isDark && styles.textMutedDark]}>
                    {r.activityDate.toLocaleDateString(locale, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </Text>
                </View>
                {best !== null ? (
                  <Text
                    style={[styles.lapTime, isDark && styles.textDark]}
                    numberOfLines={1}
                    accessibilityLabel={t('sections.bestLap')}
                  >
                    {formatDuration(best)}
                  </Text>
                ) : null}
                <Text style={[styles.lapCount, isDark && styles.textMutedDark]} numberOfLines={1}>
                  ×{r.laps.length}
                </Text>
              </View>
            );
          })
        : lapped.map((r) => (
            <View key={r.activityId} style={styles.activity}>
              <Text style={[styles.activityName, isDark && styles.textDark]} numberOfLines={1}>
                {r.activityName}
              </Text>
              <Text style={[styles.activityDate, isDark && styles.textMutedDark]}>
                {r.activityDate.toLocaleDateString(locale, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
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
                      <Text style={[styles.lapTime, isDark && styles.textDark]}>
                        {formatDuration(lap.time)}
                      </Text>
                      {lap.avgPower != null && Number.isFinite(lap.avgPower) && lap.avgPower > 0 ? (
                        <Text style={[styles.lapPower, isDark && styles.textMutedDark]}>
                          {formatPower(lap.avgPower)}
                        </Text>
                      ) : null}
                      {excluded ? (
                        <TouchableOpacity
                          testID={`section-lap-undo-${id}`}
                          style={[styles.pill, isDark && styles.pillDark]}
                          onPress={() => onIncludeLap(lap.activityId, lap.startIndex)}
                          activeOpacity={0.7}
                          hitSlop={pillHitSlop}
                        >
                          <Text style={[styles.pillMuted, isDark && styles.textMutedDark]}>
                            {t('sections.lapExcluded')}
                          </Text>
                          <Text style={[styles.pillText, isDark && { color: darkColors.linkTeal }]}>
                            {t('sections.undoExclude')}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          testID={`section-lap-exclude-${id}`}
                          style={[styles.pill, isDark && styles.pillDark]}
                          onPress={() => onExcludeLap(lap.activityId, lap.startIndex)}
                          activeOpacity={0.7}
                          hitSlop={pillHitSlop}
                        >
                          <MaterialCommunityIcons
                            name="eye-off-outline"
                            size={12}
                            color={colors.primary}
                          />
                          <Text style={[styles.pillText, isDark && { color: darkColors.linkTeal }]}>
                            {t('sections.excludeLap')}
                          </Text>
                        </TouchableOpacity>
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
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  title: { ...typography.cardTitle, color: colors.textPrimary },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  textMutedDark: { color: darkColors.textSecondary },
});
