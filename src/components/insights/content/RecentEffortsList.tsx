import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { formatDuration, formatShortDate, navigateTo } from '@/lib';
import { colors, darkColors, spacing, opacity } from '@/theme';
import type { SectionPerformanceRecord } from '@/hooks/routes/useSectionPerformances';

const MAX_EFFORTS = 5;

interface RecentEffortsListProps {
  records: SectionPerformanceRecord[];
  bestRecord: SectionPerformanceRecord | null;
  onClose: () => void;
}

/**
 * Shows the most recent efforts on a section with date, time, and
 * delta from PR. Tapping navigates to the activity detail page.
 */
export const RecentEffortsList = React.memo(function RecentEffortsList({
  records,
  bestRecord,
  onClose,
}: RecentEffortsListProps) {
  const { isDark } = useTheme();

  // Sort by date descending (most recent first) and take up to MAX_EFFORTS
  const recentEfforts = useMemo(() => {
    return [...records]
      .sort((a, b) => b.activityDate.getTime() - a.activityDate.getTime())
      .slice(0, MAX_EFFORTS);
  }, [records]);

  const handlePress = useCallback(
    (activityId: string) => {
      onClose();
      navigateTo(`/activity/${activityId}`);
    },
    [onClose]
  );

  if (recentEfforts.length === 0) return null;

  const bestTime = bestRecord?.bestTime;

  return (
    <View style={styles.container}>
      <Text style={[styles.heading, isDark && styles.headingDark]}>Recent efforts</Text>
      {recentEfforts.map((record) => {
        const isPR = bestRecord != null && record.activityId === bestRecord.activityId;
        const delta = bestTime != null && !isPR ? record.bestTime - bestTime : null;

        return (
          <Pressable
            key={record.activityId}
            style={[styles.row, isDark && styles.rowDark]}
            onPress={() => handlePress(record.activityId)}
          >
            <View style={styles.rowLeft}>
              <Text style={[styles.date, isDark && styles.dateDark]}>
                {formatShortDate(record.activityDate)}
              </Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={[styles.time, isDark && styles.timeDark]}>
                {formatDuration(record.bestTime)}
              </Text>
              {isPR ? (
                <View style={styles.prBadge}>
                  <MaterialCommunityIcons name="trophy" size={10} color="#FFFFFF" />
                  <Text style={styles.prText}>PR</Text>
                </View>
              ) : delta != null ? (
                <Text style={[styles.delta, isDark && styles.deltaDark]}>
                  +{formatDuration(delta)}
                </Text>
              ) : null}
              <MaterialCommunityIcons
                name="chevron-right"
                size={16}
                color={isDark ? darkColors.textMuted : colors.textMuted}
              />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  heading: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 2,
  },
  headingDark: {
    color: darkColors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: opacity.overlay.subtle,
  },
  rowDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  rowLeft: {
    flex: 1,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  date: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  dateDark: {
    color: darkColors.textPrimary,
  },
  time: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  timeDark: {
    color: darkColors.textPrimary,
  },
  delta: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  deltaDark: {
    color: darkColors.textSecondary,
  },
  prBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#FC4C02',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  prText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
});
