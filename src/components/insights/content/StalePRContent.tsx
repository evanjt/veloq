import React, { useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { useSectionDetail } from '@/hooks/routes/useRouteEngine';
import { navigateTo, formatDuration } from '@/lib';
import { getActivityIcon } from '@/lib/utils/activityUtils';
import { SectionInsightMap } from './SectionInsightMap';
import { colors, darkColors, spacing, opacity } from '@/theme';
import type { Insight } from '@/types';

interface StalePRContentProps {
  insight: Insight;
  onClose: () => void;
}

/**
 * Detail content for stale PR / opportunity insights.
 * Shows section map + FTP comparison data points.
 */
export const StalePRContent = React.memo(function StalePRContent({
  insight,
  onClose,
}: StalePRContentProps) {
  const { isDark } = useTheme();
  const sectionId = insight.navigationTarget?.replace('/section/', '') ?? null;
  const { section } = useSectionDetail(sectionId);
  const dataPoints = insight.supportingData?.dataPoints ?? [];

  const handleSectionPress = useCallback(() => {
    if (sectionId) {
      onClose();
      navigateTo(`/section/${sectionId}`);
    }
  }, [onClose, sectionId]);

  return (
    <View style={styles.container}>
      {/* Section map */}
      {section?.polyline && section.polyline.length >= 2 ? (
        <SectionInsightMap polyline={section.polyline} lineColor="#FF9800" />
      ) : null}

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

      {/* Section link */}
      {sectionId ? (
        <Pressable
          style={[styles.sectionLink, isDark && styles.sectionLinkDark]}
          onPress={handleSectionPress}
        >
          {section?.sportType ? (
            <MaterialCommunityIcons
              name={getActivityIcon(section.sportType)}
              size={14}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
              style={styles.sportIcon}
            />
          ) : null}
          <Text style={[styles.linkText, isDark && styles.linkTextDark]} numberOfLines={1}>
            View section details
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={18}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </Pressable>
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
  sportIcon: {
    marginRight: 4,
  },
  sectionLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: opacity.overlay.subtle,
  },
  sectionLinkDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  linkText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    marginRight: spacing.sm,
  },
  linkTextDark: {
    color: darkColors.textPrimary,
  },
});
