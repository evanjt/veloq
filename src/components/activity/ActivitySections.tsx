import React, { useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { routeEngine } from 'veloqrs';
import { useSectionMatches, type SectionMatch } from '@/hooks/routes/useSectionMatches';
import { formatDuration, formatDistance, navigateTo } from '@/lib';
import { colors, darkColors, spacing, typography } from '@/theme';

const PR_GOLD = '#D4AF37';
const MAX_VISIBLE_SECTIONS = 4;

interface SectionPRInfo {
  match: SectionMatch;
  isPR: boolean;
  time: number | undefined;
}

interface ActivitySectionsProps {
  activityId: string;
  isDark: boolean;
  isMetric: boolean;
}

/**
 * Compact section strip shown between description and tabs on the activity detail page.
 * Shows matched sections with PR badges, tappable to navigate to section detail.
 * Returns null if no sections found.
 */
export const ActivitySections = React.memo(function ActivitySections({
  activityId,
  isDark,
  isMetric,
}: ActivitySectionsProps) {
  const { t } = useTranslation();
  const { sections: sectionMatches, count } = useSectionMatches(activityId);

  // Check PR status for each section
  const sectionsWithPR = useMemo((): SectionPRInfo[] => {
    return sectionMatches.map((match) => {
      let isPR = false;
      let time: number | undefined;

      try {
        const result = routeEngine.getSectionPerformances(match.section.id);
        if (result?.bestRecord) {
          isPR = result.bestRecord.activityId === activityId;
          // Find this activity's record to get its time
          const activityRecord = result.records.find((r) => r.activityId === activityId);
          time = activityRecord?.bestTime;
        }
      } catch {
        // Engine may not have performance data yet
      }

      return { match, isPR, time };
    });
  }, [sectionMatches, activityId]);

  if (count === 0) {
    return null;
  }

  const hasPRs = sectionsWithPR.some((s) => s.isPR);
  const visibleSections = sectionsWithPR.slice(0, MAX_VISIBLE_SECTIONS);
  const remainingCount = count - MAX_VISIBLE_SECTIONS;

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <MaterialCommunityIcons
            name="road-variant"
            size={16}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>
            {t('activityDetail.tabs.sections')}
          </Text>
          <View style={[styles.countBadge, isDark && styles.countBadgeDark]}>
            <Text style={[styles.countText, isDark && styles.countTextDark]}>{count}</Text>
          </View>
        </View>
        {hasPRs && (
          <View style={styles.prBannerBadge}>
            <MaterialCommunityIcons name="trophy" size={14} color={PR_GOLD} />
            <Text style={styles.prBannerText}>{t('routes.pr')}</Text>
          </View>
        )}
      </View>

      {/* Section rows */}
      {visibleSections.map((info) => (
        <TouchableOpacity
          key={info.match.section.id}
          style={[styles.sectionRow, isDark && styles.sectionRowDark]}
          activeOpacity={0.7}
          onPress={() => navigateTo(`/section/${info.match.section.id}`)}
        >
          <View style={styles.sectionContent}>
            <View style={styles.sectionNameRow}>
              <Text style={[styles.sectionName, isDark && styles.textLight]} numberOfLines={1}>
                {info.match.section.name || t('routes.autoDetected')}
              </Text>
              {info.isPR && (
                <View style={styles.prBadge}>
                  <MaterialCommunityIcons name="trophy" size={12} color={PR_GOLD} />
                  <Text style={styles.prBadgeText}>{t('routes.pr')}</Text>
                </View>
              )}
            </View>
            <View style={styles.sectionMeta}>
              <Text style={[styles.metaText, isDark && styles.textMuted]}>
                {formatDistance(info.match.distance, isMetric)}
              </Text>
              {info.time != null && (
                <>
                  <Text style={[styles.metaDot, isDark && styles.textMuted]}> · </Text>
                  <Text
                    style={[
                      styles.timeText,
                      isDark && styles.textLight,
                      info.isPR && styles.prTimeText,
                    ]}
                  >
                    {formatDuration(info.time)}
                  </Text>
                </>
              )}
            </View>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={18}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </TouchableOpacity>
      ))}

      {/* "View all" link if more sections */}
      {remainingCount > 0 && (
        <Text style={[styles.viewAllText, isDark && styles.textMuted]}>
          {t('activityDetail.tabs.sections')} +{remainingCount}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  containerDark: {
    backgroundColor: darkColors.surface,
    borderBottomColor: darkColors.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerTitle: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  countBadge: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  countBadgeDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  countText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  countTextDark: {
    color: darkColors.textSecondary,
  },
  prBannerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: PR_GOLD + '1A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  prBannerText: {
    fontSize: 11,
    fontWeight: '700',
    color: PR_GOLD,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  sectionRowDark: {
    borderTopColor: darkColors.border,
  },
  sectionContent: {
    flex: 1,
  },
  sectionNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sectionName: {
    fontSize: typography.body.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  prBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: PR_GOLD + '1A',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
  },
  prBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: PR_GOLD,
  },
  sectionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 1,
  },
  metaText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  metaDot: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  timeText: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  prTimeText: {
    color: PR_GOLD,
  },
  viewAllText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingTop: spacing.xs,
  },
});
