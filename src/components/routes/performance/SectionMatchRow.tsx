import React, { useCallback } from 'react';
import { TouchableOpacity, View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatDistance, getActivityColor } from '@/lib';
import { useMetricSystem } from '@/hooks';
import { colors, darkColors, opacity, spacing, layout, typography } from '@/theme';
import type { ActivityType } from '@/types';
import type { SectionMatch } from '@/hooks/routes/useSectionMatches';

interface SectionRowProps {
  match: SectionMatch;
  activityType: ActivityType;
  isDark: boolean;
  isLast: boolean;
}

export function SectionMatchRow({ match, activityType, isDark, isLast }: SectionRowProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const { section, direction, distance } = match;
  const activityColor = getActivityColor(activityType);
  const isReverse = direction === 'reverse';

  const handlePress = useCallback(() => {
    router.push(`/section/${section.id}` as Href);
  }, [section.id]);

  return (
    <TouchableOpacity
      style={[
        styles.sectionRow,
        isDark && styles.sectionRowDark,
        !isLast && styles.sectionRowBorder,
        !isLast && isDark && styles.sectionRowBorderDark,
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <View style={[styles.sectionIcon, { backgroundColor: activityColor + '20' }]}>
        <MaterialCommunityIcons name="road-variant" size={16} color={activityColor} />
      </View>
      <View style={styles.sectionInfo}>
        <Text style={[styles.sectionName, isDark && styles.textLight]} numberOfLines={1}>
          {section.name || t('sections.defaultName', { number: section.id.split('_').pop() })}
        </Text>
        <View style={styles.sectionMeta}>
          <Text style={[styles.sectionDistance, isDark && styles.textMuted]}>
            {formatDistance(distance, isMetric)}
          </Text>
          <Text style={[styles.sectionDot, isDark && styles.textMuted]}>·</Text>
          <Text style={[styles.sectionVisits, isDark && styles.textMuted]}>
            {section.visitCount} {t('sections.traversals')}
          </Text>
          {isReverse && (
            <View style={styles.sectionDirectionBadge}>
              <MaterialCommunityIcons name="swap-horizontal" size={10} color="#9C27B0" />
            </View>
          )}
        </View>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={isDark ? '#555' : '#CCC'} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
  },
  sectionRowDark: {},
  sectionRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: opacity.overlay.light,
  },
  sectionRowBorderDark: {
    borderBottomColor: opacity.overlayDark.light,
  },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: layout.borderRadiusSm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionInfo: {
    flex: 1,
  },
  sectionName: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  sectionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: spacing.xs,
  },
  sectionDistance: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  sectionDot: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  sectionVisits: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  sectionDirectionBadge: {
    backgroundColor: 'rgba(156, 39, 176, 0.15)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 2,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
