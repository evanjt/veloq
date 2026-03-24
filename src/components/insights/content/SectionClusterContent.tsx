import React, { useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { navigateTo, formatDuration } from '@/lib';
import { colors, darkColors, spacing, shadows, opacity } from '@/theme';
import type { Insight, SupportingSection } from '@/types';

interface SectionClusterContentProps {
  insight: Insight;
  onClose: () => void;
}

function getTrendIcon(trend?: number): string {
  if (trend == null) return 'minus';
  if (trend > 0) return 'trending-up';
  if (trend < 0) return 'trending-down';
  return 'minus';
}

function getTrendColor(trend?: number, isDark?: boolean): string {
  if (trend == null) return isDark ? darkColors.textSecondary : colors.textSecondary;
  if (trend > 0) return colors.success;
  if (trend < 0) return colors.warning;
  return isDark ? darkColors.textSecondary : colors.textSecondary;
}

/**
 * Detail content for section cluster insights.
 * Shows all sections in the cluster with their trend indicators.
 */
export const SectionClusterContent = React.memo(function SectionClusterContent({
  insight,
  onClose,
}: SectionClusterContentProps) {
  const { isDark } = useTheme();
  const sections = insight.supportingData?.sections ?? [];

  const handleSectionPress = useCallback(
    (sectionId: string) => {
      onClose();
      navigateTo(`/section/${sectionId}`);
    },
    [onClose]
  );

  if (sections.length === 0) return null;

  return (
    <View style={styles.container}>
      {/* Section list */}
      {sections.map((section: SupportingSection) => (
        <Pressable
          key={section.sectionId}
          style={[styles.sectionCard, isDark && styles.sectionCardDark]}
          onPress={() => handleSectionPress(section.sectionId)}
        >
          <View style={styles.sectionContent}>
            <Text style={[styles.sectionName, isDark && styles.sectionNameDark]} numberOfLines={1}>
              {section.sectionName}
            </Text>
            <View style={styles.sectionMeta}>
              {section.bestTime != null ? (
                <Text style={[styles.bestTime, isDark && styles.bestTimeDark]}>
                  {formatDuration(section.bestTime)}
                </Text>
              ) : null}
              {section.traversalCount != null ? (
                <Text style={[styles.traversals, isDark && styles.traversalsDark]}>
                  {section.traversalCount}x
                </Text>
              ) : null}
              <MaterialCommunityIcons
                name={getTrendIcon(section.trend) as never}
                size={16}
                color={getTrendColor(section.trend, isDark)}
              />
            </View>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={18}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </Pressable>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  sectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
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
  sectionName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    marginRight: spacing.sm,
  },
  sectionNameDark: {
    color: darkColors.textPrimary,
  },
  sectionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  bestTime: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  bestTimeDark: {
    color: darkColors.textPrimary,
  },
  traversals: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  traversalsDark: {
    color: darkColors.textSecondary,
  },
});
