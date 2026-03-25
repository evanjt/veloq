import React, { useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { useSectionDetail } from '@/hooks/routes/useRouteEngine';
import { navigateTo, formatDuration } from '@/lib';
import { getActivityIcon } from '@/lib/utils/activityUtils';
import { SectionInsightMap } from './SectionInsightMap';
import { colors, darkColors, spacing, opacity, shadows } from '@/theme';
import type { Insight, SupportingSection } from '@/types';

interface StalePRContentProps {
  insight: Insight;
}

/** Map preview for the first section */
const TopSectionMap = React.memo(function TopSectionMap({ sectionId }: { sectionId: string }) {
  const { section } = useSectionDetail(sectionId);
  if (!section?.polyline || section.polyline.length < 2) return null;
  return <SectionInsightMap polyline={section.polyline} lineColor="#FF9800" />;
});

/**
 * Detail content for stale PR / opportunity insights.
 * Shows section map + FTP comparison data points + tappable section list.
 */
export const StalePRContent = React.memo(function StalePRContent({ insight }: StalePRContentProps) {
  const { isDark } = useTheme();
  const dataPoints = insight.supportingData?.dataPoints ?? [];
  const sections = insight.supportingData?.sections ?? [];
  const topSectionId = sections[0]?.sectionId ?? null;

  const handleSectionPress = useCallback((id: string) => {
    navigateTo(`/section/${id}`);
  }, []);

  return (
    <View style={styles.container}>
      {/* Map preview of the top section */}
      {topSectionId ? <TopSectionMap sectionId={topSectionId} /> : null}

      {/* FTP comparison data */}
      {dataPoints.length > 0 ? (
        <View style={[styles.dataCard, isDark && styles.dataCardDark]}>
          {dataPoints.map((dp, i) => (
            <View key={i} style={styles.dataRow}>
              <Text style={[styles.dataLabel, isDark && styles.dataLabelDark]}>{dp.label}</Text>
              <Text
                style={[
                  styles.dataValue,
                  isDark && styles.dataValueDark,
                  dp.context === 'good' && styles.dataValueGood,
                ]}
              >
                {String(dp.value)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Section list — all beatable PRs */}
      {sections.length > 0 ? (
        <View style={styles.sectionList}>
          {sections.map((s: SupportingSection) => (
            <Pressable
              key={s.sectionId}
              style={[styles.sectionCard, isDark && styles.sectionCardDark]}
              onPress={() => handleSectionPress(s.sectionId)}
            >
              <View style={styles.sectionContent}>
                <View style={styles.sectionNameRow}>
                  {s.sportType ? (
                    <MaterialCommunityIcons
                      name={getActivityIcon(s.sportType)}
                      size={14}
                      color={isDark ? darkColors.textSecondary : colors.textSecondary}
                      style={styles.sportIcon}
                    />
                  ) : null}
                  <Text
                    style={[styles.sectionName, isDark && styles.sectionNameDark]}
                    numberOfLines={1}
                  >
                    {s.sectionName}
                  </Text>
                </View>
                {s.bestTime != null ? (
                  <Text style={[styles.bestTime, isDark && styles.bestTimeDark]}>
                    {formatDuration(s.bestTime)}
                  </Text>
                ) : null}
              </View>
              <MaterialCommunityIcons
                name="chevron-right"
                size={18}
                color={isDark ? darkColors.textSecondary : colors.textSecondary}
              />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  dataCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.md,
    gap: spacing.sm,
  },
  dataCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dataLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  dataLabelDark: {
    color: darkColors.textSecondary,
  },
  dataValue: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  dataValueDark: {
    color: darkColors.textPrimary,
  },
  dataValueGood: {
    color: '#22C55E',
  },
  sectionList: {
    gap: spacing.xs,
  },
  sectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  sectionCardDark: {
    backgroundColor: darkColors.surfaceCard,
    borderColor: darkColors.border,
    ...shadows.none,
  },
  sectionContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: spacing.xs,
  },
  sectionNameRow: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginRight: spacing.sm,
  },
  sportIcon: {
    marginRight: 4,
  },
  sectionName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  sectionNameDark: {
    color: darkColors.textPrimary,
  },
  bestTime: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  bestTimeDark: {
    color: darkColors.textPrimary,
  },
});
