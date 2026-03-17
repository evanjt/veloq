import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, shadows, colorWithOpacity } from '@/theme';
import type { Insight } from '@/types';

const CATEGORY_COLORS: Record<string, string> = {
  section_pr: '#FFD700',
  fitness_milestone: '#4CAF50',
  period_comparison: '#2196F3',
  activity_pattern: '#9C27B0',
  training_consistency: '#FF9800',
  hrv_trend: '#66BB6A',
  tsb_form: '#42A5F5',
  weekly_load: '#FFA726',
  intensity_context: '#FFA726',
};

interface InsightListCardProps {
  insight: Insight;
  onPress: (insight: Insight) => void;
}

export const InsightListCard = React.memo(function InsightListCard({
  insight,
  onPress,
}: InsightListCardProps) {
  const { isDark } = useTheme();
  const categoryColor = CATEGORY_COLORS[insight.category] ?? colors.primary;

  return (
    <TouchableOpacity
      style={[styles.card, isDark && styles.cardDark]}
      onPress={() => onPress(insight)}
      activeOpacity={0.7}
    >
      <View style={[styles.colorBar, { backgroundColor: categoryColor }]} />
      <View style={[styles.iconCircle, { backgroundColor: colorWithOpacity(categoryColor, 0.1) }]}>
        <MaterialCommunityIcons
          name={insight.icon as keyof typeof MaterialCommunityIcons.glyphMap}
          size={20}
          color={insight.iconColor}
        />
      </View>
      <View style={styles.textContainer}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, isDark && styles.titleDark]} numberOfLines={1}>
            {insight.title}
          </Text>
          {insight.isNew ? <View style={styles.newDot} /> : null}
        </View>
        {insight.subtitle ? (
          <Text style={[styles.subtitle, isDark && styles.subtitleDark]} numberOfLines={1}>
            {insight.subtitle}
          </Text>
        ) : null}
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={18}
        color={isDark ? darkColors.textMuted : colors.textMuted}
        style={styles.chevron}
      />
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    ...shadows.card,
  },
  cardDark: {
    backgroundColor: darkColors.surfaceCard,
    borderWidth: 1,
    borderColor: darkColors.border,
    ...shadows.none,
  },
  colorBar: {
    width: 4,
    alignSelf: 'stretch',
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
    marginVertical: spacing.sm,
  },
  textContainer: {
    flex: 1,
    marginLeft: spacing.sm,
    marginRight: spacing.xs,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  newDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FC4C02',
  },
  subtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  subtitleDark: {
    color: darkColors.textSecondary,
  },
  chevron: {
    marginRight: spacing.sm,
  },
});
