import React, { useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { routeEngine } from 'veloqrs';
import { useSectionMatches } from '@/hooks/routes/useSectionMatches';
import { formatDuration, navigateTo } from '@/lib';
import { colors, darkColors, spacing } from '@/theme';

const PR_GOLD = '#D4AF37';

interface PRSection {
  sectionId: string;
  sectionName: string;
  time: number;
}

interface ActivitySectionsProps {
  activityId: string;
  isDark: boolean;
}

/**
 * Compact PR banner shown on the activity detail page when the activity
 * holds a section PR. Only renders when PRs exist — zero layout impact otherwise.
 * The full section list already exists in the Sections tab.
 */
export const ActivitySections = React.memo(function ActivitySections({
  activityId,
  isDark,
}: ActivitySectionsProps) {
  const { sections: sectionMatches } = useSectionMatches(activityId);

  const prSections = useMemo((): PRSection[] => {
    const prs: PRSection[] = [];
    for (const match of sectionMatches) {
      try {
        const result = routeEngine.getSectionPerformances(match.section.id);
        if (result?.bestRecord?.activityId === activityId) {
          const record = result.records.find((r) => r.activityId === activityId);
          if (record) {
            prs.push({
              sectionId: match.section.id,
              sectionName: match.section.name || 'Section',
              time: record.bestTime,
            });
          }
        }
      } catch {
        // Engine may not have performance data yet
      }
    }
    return prs;
  }, [sectionMatches, activityId]);

  if (prSections.length === 0) return null;

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.headerRow}>
        <MaterialCommunityIcons name="trophy" size={16} color={PR_GOLD} />
        <Text style={[styles.headerText, isDark && styles.headerTextDark]}>
          {prSections.length === 1 ? 'Section PR' : `${prSections.length} Section PRs`}
        </Text>
      </View>
      {prSections.map((pr) => (
        <TouchableOpacity
          key={pr.sectionId}
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
            color={isDark ? darkColors.textMuted : colors.textMuted}
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
    color: PR_GOLD,
  },
  headerTextDark: {
    color: PR_GOLD,
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
    color: colors.textPrimary,
  },
  sectionNameDark: {
    color: darkColors.textPrimary,
  },
  prTime: {
    fontSize: 14,
    fontWeight: '700',
    color: PR_GOLD,
  },
});
