import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, shadows } from '@/theme';
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

interface InsightCardProps {
  insight: Insight;
  onPress?: (insight: Insight) => void;
}

export const InsightCard = React.memo(function InsightCard({ insight, onPress }: InsightCardProps) {
  const { isDark } = useTheme();
  const categoryColor = CATEGORY_COLORS[insight.category] ?? colors.primary;

  const handlePress = () => {
    if (onPress) {
      onPress(insight);
    } else if (insight.navigationTarget) {
      router.push(insight.navigationTarget as never);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.card, isDark && styles.cardDark]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <View style={[styles.colorBar, { backgroundColor: categoryColor }]} />
      <View style={styles.content}>
        <MaterialCommunityIcons name={insight.icon as never} size={20} color={insight.iconColor} />
        <Text style={[styles.title, isDark && styles.titleDark]} numberOfLines={2}>
          {insight.title}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  card: {
    width: 120,
    height: 80,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    marginRight: spacing.sm,
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
    height: 3,
    width: '100%',
  },
  content: {
    flex: 1,
    padding: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  title: {
    fontSize: 13,
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 16,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
});
