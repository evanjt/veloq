/**
 * Laps of the activities that crossed the section more than once, each
 * with its own exclude. An excluded lap stays listed, muted, with an undo.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { formatDuration, getIntlLocale } from '@/shared/format/format';
import { lapKey } from '@/features/routes/hooks/useSectionLaps';
import { colors, darkColors, spacing, typography, layout } from '@/theme';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';

export interface SectionLapListProps {
  isDark: boolean;
  records: SectionPerformanceRecord[];
  excludedLaps: Set<string>;
  onExcludeLap: (activityId: string, startIndex: number) => void;
  onIncludeLap: (activityId: string, startIndex: number) => void;
}

export function SectionLapList({
  isDark,
  records,
  excludedLaps,
  onExcludeLap,
  onIncludeLap,
}: SectionLapListProps) {
  const { t } = useTranslation();
  const locale = getIntlLocale();
  const lapped = records.filter((r) => r.laps.length > 1);
  if (lapped.length === 0) return null;

  return (
    <View style={[styles.card, isDark && styles.cardDark]} testID="section-lap-list">
      <View style={styles.header}>
        <MaterialCommunityIcons
          name="repeat"
          size={18}
          color={isDark ? darkColors.textPrimary : colors.textPrimary}
        />
        <Text style={[styles.title, isDark && styles.textDark]}>{t('sections.laps')}</Text>
      </View>
      {lapped.map((r) => (
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
              const excluded = excludedLaps.has(lapKey(lap.activityId, lap.startIndex));
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
                  {excluded ? (
                    <TouchableOpacity
                      testID={`section-lap-undo-${id}`}
                      style={[styles.pill, isDark && styles.pillDark]}
                      onPress={() => onIncludeLap(lap.activityId, lap.startIndex)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.pillMuted, isDark && styles.textMutedDark]}>
                        {t('sections.lapExcluded')}
                      </Text>
                      <Text style={styles.pillText}>{t('sections.undoExclude')}</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      testID={`section-lap-exclude-${id}`}
                      style={[styles.pill, isDark && styles.pillDark]}
                      onPress={() => onExcludeLap(lap.activityId, lap.startIndex)}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons
                        name="eye-off-outline"
                        size={12}
                        color={colors.primary}
                      />
                      <Text style={styles.pillText}>{t('sections.excludeLap')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: layout.screenPadding,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: layout.borderRadius,
    backgroundColor: colors.surface,
  },
  cardDark: { backgroundColor: darkColors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  title: { ...typography.cardTitle, color: colors.textPrimary },
  activity: { marginTop: spacing.sm },
  activityName: { ...typography.bodySmall, color: colors.textPrimary },
  activityDate: { ...typography.caption, color: colors.textSecondary },
  lapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: layout.minTapTarget,
  },
  lapRowExcluded: { opacity: 0.6 },
  lapLabel: { ...typography.bodySmall, color: colors.textPrimary, flex: 1 },
  lapTime: { ...typography.metricValue, color: colors.textPrimary },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusLg,
    backgroundColor: colors.background,
  },
  pillDark: { backgroundColor: darkColors.surfaceElevated },
  pillText: { ...typography.caption, color: colors.primary },
  pillMuted: { ...typography.caption, color: colors.textSecondary },
  textDark: { color: darkColors.textPrimary },
  textMutedDark: { color: darkColors.textSecondary },
});
