import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useActivities, useTheme } from '@/hooks';
import { formatPaceCompact, formatSwimPace, formatDuration, formatLocalDate } from '@/lib';
import { SPORT_COLORS, type PrimarySport } from '@/providers';
import { colors, darkColors, spacing, typography, layout } from '@/theme';
import type { BestEffort } from '@/hooks';

interface SeasonBestsSectionProps {
  efforts: BestEffort[];
  sport: PrimarySport;
  days: number;
  isLoading: boolean;
}

function formatEffortValue(effort: BestEffort, sport: PrimarySport): string {
  if (effort.value === null || !Number.isFinite(effort.value)) return '-';

  if (sport === 'Cycling') {
    return `${Math.round(effort.value)}w`;
  }
  if (sport === 'Running') {
    return `${formatPaceCompact(effort.value)}/km`;
  }
  if (sport === 'Swimming') {
    return `${formatSwimPace(effort.value)}/100m`;
  }
  return '-';
}

function formatEffortTime(effort: BestEffort): string | null {
  if (effort.time === null || !Number.isFinite(effort.time)) return null;
  return formatDuration(effort.time);
}

export function SeasonBestsSection({ efforts, sport, days, isLoading }: SeasonBestsSectionProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const sportColor = SPORT_COLORS[sport];

  // Fetch activities to look up names for activity IDs
  const daysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return formatLocalDate(d);
  }, [days]);

  const { data: activities } = useActivities({ oldest: daysAgo });

  const activityMap = useMemo(() => {
    const map = new Map<string, string>();
    if (activities) {
      for (const a of activities) {
        map.set(a.id, a.name);
      }
    }
    return map;
  }, [activities]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  if (efforts.length === 0 || efforts.every((e) => e.value === null)) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, isDark && styles.emptyTextDark]}>
          {t('statsScreen.noEffortData')}
        </Text>
      </View>
    );
  }

  return (
    <View>
      {efforts.map((effort, index) => {
        const activityName = effort.activityId ? activityMap.get(effort.activityId) : undefined;
        const timeStr = formatEffortTime(effort);

        return (
          <View
            key={effort.label}
            style={[
              styles.row,
              isDark && styles.rowDark,
              index < efforts.length - 1 && styles.rowBorder,
              index < efforts.length - 1 && isDark && styles.rowBorderDark,
            ]}
          >
            <Text style={[styles.label, isDark && styles.labelDark]}>{effort.label}</Text>
            <View style={styles.valueColumn}>
              <Text style={[styles.value, { color: sportColor }]}>
                {formatEffortValue(effort, sport)}
              </Text>
              {timeStr && sport !== 'Cycling' && (
                <Text style={[styles.time, isDark && styles.timeDark]}>{timeStr}</Text>
              )}
            </View>
            <View style={styles.activityColumn}>
              {activityName && effort.activityId ? (
                <TouchableOpacity
                  onPress={() => router.push(`/activity/${effort.activityId}`)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={[styles.activityName, { color: sportColor }]} numberOfLines={1}>
                    {activityName} →
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        );
      })}
      <TouchableOpacity
        testID="season-bests-view-all"
        style={[styles.viewAllRow, isDark && styles.viewAllRowDark]}
        onPress={() => router.push('/best-efforts')}
        activeOpacity={0.7}
      >
        <Text style={[styles.viewAllText, { color: sportColor }]}>
          {t('bestEffortsScreen.title')}
        </Text>
        <MaterialCommunityIcons name="chevron-right" size={18} color={sportColor} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  emptyTextDark: {
    color: darkColors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
  },
  rowDark: {},
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0, 0, 0, 0.08)',
  },
  rowBorderDark: {
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  label: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.textSecondary,
    width: 48,
  },
  labelDark: {
    color: darkColors.textSecondary,
  },
  valueColumn: {
    width: 100,
    alignItems: 'flex-end',
  },
  value: {
    ...typography.body,
    fontWeight: '700',
  },
  time: {
    ...typography.micro,
    color: colors.textSecondary,
    marginTop: 1,
  },
  timeDark: {
    color: darkColors.textSecondary,
  },
  activityColumn: {
    flex: 1,
    marginLeft: spacing.md,
  },
  activityName: {
    ...typography.caption,
    fontWeight: '500',
  },
  viewAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0, 0, 0, 0.08)',
  },
  viewAllRowDark: {
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  viewAllText: {
    ...typography.caption,
    fontWeight: '600',
    marginRight: 4,
  },
});
