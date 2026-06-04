import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { navigateTo } from '@/lib';
import { colors, darkColors, spacing, shadows, insightCategoryColors } from '@/theme';
import type { Insight } from '@/types';

interface InsightCardProps {
  insight: Insight;
  onPress?: (insight: Insight) => void;
}

export const InsightCard = React.memo(function InsightCard({ insight, onPress }: InsightCardProps) {
  const { isDark } = useTheme();
  const categoryColor = insightCategoryColors[insight.category] ?? colors.primary;

  const handlePress = () => {
    if (onPress) {
      onPress(insight);
    } else if (insight.navigationTarget) {
      navigateTo(insight.navigationTarget);
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
