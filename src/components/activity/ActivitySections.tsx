import React, { useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { formatDuration, navigateTo } from '@/lib';
import { brand, darkColors, spacing } from '@/theme';

interface PRSection {
  sectionId: string;
  sectionName: string;
  time: number;
  direction: string;
}

interface ActivitySectionsProps {
  activityId: string;
  isDark: boolean;
}

/**
 * Compact PR banner shown on the activity detail page when the activity
 * holds a section PR. Only renders when PRs exist — zero layout impact otherwise.
 *
 * Reads from the materialized `activity_indicators` table via a single FFI call.
 */
export const ActivitySections = React.memo(function ActivitySections({
  activityId,
  isDark,
}: ActivitySectionsProps) {
  const prSections = useMemo((): PRSection[] => {
    const engine = getRouteEngine();
    if (!engine) return [];

    try {
      const indicators = engine.getIndicatorsForActivity(activityId);
      return indicators
        .filter((ind) => ind.indicatorType === 'section_pr')
        .map((ind) => ({
          sectionId: ind.targetId,
          sectionName: ind.targetName || 'Section',
          time: ind.lapTime,
          direction: ind.direction,
        }));
    } catch {
      return [];
    }
  }, [activityId]);

  if (prSections.length === 0) return null;

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.headerRow}>
        <MaterialCommunityIcons name="trophy" size={16} color={brand.gold} />
        <Text style={styles.headerText}>
          {prSections.length === 1 ? 'Section PR' : `${prSections.length} Section PRs`}
        </Text>
      </View>
      {prSections.map((pr) => (
        <TouchableOpacity
          key={`${pr.sectionId}-${pr.direction}`}
          style={styles.prRow}
          activeOpacity={0.7}
          onPress={() => navigateTo(`/section/${pr.sectionId}`)}
        >
          <Text style={[styles.sectionName, isDark && styles.sectionNameDark]} numberOfLines={1}>
            {pr.sectionName}
          </Text>
          <Text style={styles.prTime}>{formatDuration(pr.time)}</Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={14}
            color={isDark ? darkColors.textMuted : '#71717A'}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: 'rgba(212, 175, 55, 0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  containerDark: {
    backgroundColor: 'rgba(212, 175, 55, 0.06)',
    borderColor: 'rgba(212, 175, 55, 0.15)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  headerText: {
    fontSize: 13,
    fontWeight: '700',
    color: brand.gold,
  },
  prRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: spacing.xs,
  },
  sectionName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#18181B',
  },
  sectionNameDark: {
    color: darkColors.textPrimary,
  },
  prTime: {
    fontSize: 14,
    fontWeight: '700',
    color: brand.gold,
  },
});
