import React, { useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { navigateTo } from '@/lib';
import { colors, darkColors, spacing, shadows } from '@/theme';
import type { Insight } from '@/types';
import { SupportingDataSection } from '../SupportingDataSection';

interface EfficiencyTrendContentProps {
  insight: Insight;
  onClose: () => void;
}

/**
 * Detail content for aerobic efficiency trend insights.
 * Shows the section name, HR change headline, effort count,
 * and a link to the section detail page.
 */
export const EfficiencyTrendContent = React.memo(function EfficiencyTrendContent({
  insight,
  onClose,
}: EfficiencyTrendContentProps) {
  const { isDark } = useTheme();

  const sectionId = insight.supportingData?.sections?.[0]?.sectionId;
  const sectionName = insight.supportingData?.sections?.[0]?.sectionName;

  const hrChangePoint = insight.supportingData?.dataPoints?.find((dp) => dp.unit === 'bpm');
  const effortCountPoint = insight.supportingData?.dataPoints?.find((dp) =>
    dp.label?.toLowerCase().includes('effort')
  );

  const handleSectionPress = useCallback(() => {
    if (!sectionId) return;
    onClose();
    navigateTo(`/section/${sectionId}`);
  }, [sectionId, onClose]);

  return (
    <View style={styles.container}>
      {/* HR change headline */}
      {hrChangePoint ? (
        <View style={[styles.headlineCard, isDark && styles.headlineCardDark]}>
          <MaterialCommunityIcons name="heart-pulse" size={28} color="#66BB6A" />
          <View style={styles.headlineText}>
            <Text style={[styles.hrChange, isDark && styles.hrChangeDark]}>
              {hrChangePoint.value} {hrChangePoint.unit}
            </Text>
            <Text style={[styles.hrLabel, isDark && styles.hrLabelDark]}>at the same pace</Text>
          </View>
          {effortCountPoint ? (
            <View style={styles.effortBadge}>
              <Text style={styles.effortCount}>{effortCountPoint.value}</Text>
              <Text style={styles.effortLabel}>efforts</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Section link */}
      {sectionId && sectionName ? (
        <Pressable
          style={[styles.sectionLink, isDark && styles.sectionLinkDark]}
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

      {/* Supporting data (methodology, etc.) */}
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
    borderRadius: 10,
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
  hrChange: {
    fontSize: 22,
    fontWeight: '700',
    color: '#66BB6A',
  },
  hrChangeDark: {
    color: '#81C784',
  },
  hrLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  hrLabelDark: {
    color: darkColors.textSecondary,
  },
  effortBadge: {
    alignItems: 'center',
    backgroundColor: '#66BB6A18',
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  effortCount: {
    fontSize: 18,
    fontWeight: '700',
    color: '#66BB6A',
  },
  effortLabel: {
    fontSize: 10,
    color: '#66BB6A',
    fontWeight: '500',
  },
  sectionLink: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
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
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  sectionNameDark: {
    color: darkColors.textPrimary,
  },
});
