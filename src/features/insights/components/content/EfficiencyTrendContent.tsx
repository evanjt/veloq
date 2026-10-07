import React, { useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import { colors, darkColors, spacing, shadows, layout, typography } from '@/theme';
import type { Insight } from '@/types';
import { SupportingDataSection } from '../SupportingDataSection';
import { pressable, pressRipple } from '@/shared/ui';

interface EfficiencyTrendContentProps {
  insight: Insight;
}

/**
 * Detail content for aerobic efficiency trend insights.
 * Shows the section name, HR change headline, effort count,
 * and a link to the section detail page.
 */
export const EfficiencyTrendContent = React.memo(function EfficiencyTrendContent({
  insight,
}: EfficiencyTrendContentProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  const sectionId = insight.supportingData?.sections?.[0]?.sectionId;
  const sectionName = insight.supportingData?.sections?.[0]?.sectionName;

  const hrChangePoint = insight.supportingData?.dataPoints?.find((dp) => dp.key === 'hrChange');
  const effortCountPoint = insight.supportingData?.dataPoints?.find(
    (dp) => dp.key === 'effortCount'
  );

  const handleSectionPress = useCallback(() => {
    if (!sectionId) return;
    navigateTo(`/section/${sectionId}`);
  }, [sectionId]);

  return (
    <View style={styles.container}>
      {hrChangePoint ? (
        <View style={[styles.headlineCard, isDark && styles.headlineCardDark]}>
          <MaterialCommunityIcons name="heart-pulse" size={28} color={colors.formOptimal} />
          <View style={styles.headlineText}>
            <Text style={[styles.hrChange, isDark && styles.hrChangeDark]}>
              {hrChangePoint.value} {hrChangePoint.unit}
            </Text>
            <Text style={[styles.hrLabel, isDark && styles.hrLabelDark]}>
              {t('insights.efficiencyTrend.sheetHrCaption')}
            </Text>
          </View>
          {effortCountPoint ? (
            <View style={styles.effortBadge}>
              <Text style={[styles.effortCount, isDark && styles.effortCountDark]}>
                {effortCountPoint.value}
              </Text>
              <Text style={[styles.effortLabel, isDark && styles.effortLabelDark]}>
                {effortCountPoint.label}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.contextCard, isDark && styles.contextCardDark]}>
        <Text style={[styles.contextHeading, isDark && styles.contextHeadingDark]}>
          {t('insights.efficiencyTrend.sheetHeading')}
        </Text>
        <Text style={[styles.contextBody, isDark && styles.contextBodyDark]}>
          {t('insights.efficiencyTrend.sheetBody')}
        </Text>
        <Text style={[styles.contextMeta, isDark && styles.contextMetaDark]}>
          {t('insights.efficiencyTrend.sheetMeta')}
        </Text>
      </View>

      {sectionId && sectionName ? (
        <Pressable
          style={pressable([styles.sectionLink, isDark && styles.sectionLinkDark])}
          android_ripple={pressRipple}
          onPress={handleSectionPress}
        >
          <MaterialCommunityIcons
            name="map-marker-path"
            size={18}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.sectionName, isDark && styles.sectionNameDark]} numberOfLines={1}>
            {sectionName}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={18}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </Pressable>
      ) : null}

      {insight.supportingData ? <SupportingDataSection data={insight.supportingData} /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  headlineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadiusMd,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    ...shadows.card,
  },
  headlineCardDark: {
    backgroundColor: darkColors.surfaceCard,
    borderColor: darkColors.border,
    ...shadows.none,
  },
  headlineText: {
    flex: 1,
  },
  contextCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadiusMd,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
    ...shadows.card,
  },
  contextCardDark: {
    backgroundColor: darkColors.surfaceCard,
    borderColor: darkColors.border,
    ...shadows.none,
  },
  contextHeading: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  contextHeadingDark: {
    color: darkColors.textPrimary,
  },
  contextBody: {
    fontSize: typography.bodyCompact.fontSize,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  contextBodyDark: {
    color: darkColors.textPrimary,
  },
  contextMeta: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  contextMetaDark: {
    color: darkColors.textSecondary,
  },
  hrChange: {
    fontSize: typography.sectionTitle.fontSize,
    fontWeight: '700',
    color: colors.formOptimalText,
  },
  hrChangeDark: {
    color: darkColors.formOptimalText,
  },
  hrLabel: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  hrLabelDark: {
    color: darkColors.textSecondary,
  },
  effortBadge: {
    alignItems: 'center',
    backgroundColor: colors.formOptimal + '18',
    borderRadius: layout.borderRadiusSm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  effortCount: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
    color: colors.formOptimalText,
  },
  effortCountDark: {
    color: darkColors.formOptimalText,
  },
  effortLabel: {
    fontSize: typography.micro.fontSize,
    color: colors.formOptimalText,
    fontWeight: '500',
  },
  effortLabelDark: {
    color: darkColors.formOptimalText,
  },
  sectionLink: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadiusMd,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
    ...shadows.card,
  },
  sectionLinkDark: {
    backgroundColor: darkColors.surfaceCard,
    borderColor: darkColors.border,
    ...shadows.none,
  },
  sectionName: {
    flex: 1,
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  sectionNameDark: {
    color: darkColors.textPrimary,
  },
});
