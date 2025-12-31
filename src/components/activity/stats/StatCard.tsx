/**
 * Individual stat card component for InsightfulStats.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, darkColors, opacity, typography, layout } from '@/theme';
import type { StatDetail } from './types';

interface StatCardProps {
  stat: StatDetail;
  isDark: boolean;
  onPress: (stat: StatDetail) => void;
}

export function StatCard({ stat, isDark, onPress }: StatCardProps) {
  return (
    <Pressable
      onLongPress={() => onPress(stat)}
      onPress={() => onPress(stat)}
      delayLongPress={300}
      style={({ pressed }) => [
        styles.statCard,
        isDark && styles.statCardDark,
        pressed && styles.statCardPressed,
      ]}
    >
      {/* Icon with colored background */}
      <View style={[styles.iconContainer, { backgroundColor: `${stat.color}20` }]}>
        <MaterialCommunityIcons
          name={stat.icon}
          size={16}
          color={stat.color}
        />
      </View>

      {/* Value and title */}
      <View style={styles.statContent}>
        <Text style={[styles.statValue, isDark && styles.textLight]}>
          {stat.value}
        </Text>
        <Text style={styles.statTitle}>{stat.title}</Text>
      </View>

      {/* Comparison badge or context */}
      {stat.comparison ? (
        <View style={[
          styles.comparisonBadge,
          stat.comparison.isGood === true && styles.comparisonGood,
          stat.comparison.isGood === false && styles.comparisonBad,
        ]}>
          <MaterialCommunityIcons
            name={stat.comparison.trend === 'up' ? 'arrow-up' : stat.comparison.trend === 'down' ? 'arrow-down' : 'minus'}
            size={10}
            color={stat.comparison.isGood === true ? colors.success : stat.comparison.isGood === false ? colors.error : colors.textSecondary}
          />
          <Text style={[
            styles.comparisonText,
            stat.comparison.isGood === true && styles.comparisonTextGood,
            stat.comparison.isGood === false && styles.comparisonTextBad,
          ]}>
            {stat.comparison.value}
          </Text>
        </View>
      ) : stat.context ? (
        <Text style={styles.contextText} numberOfLines={1}>
          {stat.context}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  statCard: {
    width: '31%', // 3 columns with gaps
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 10,
    position: 'relative',
  },
  statCardDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  statCardPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: layout.borderRadiusSm,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  statContent: {
    marginBottom: 2,
  },
  statValue: {
    fontSize: typography.metricValue.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  statTitle: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
  },
  comparisonBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: opacity.overlay.light,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: layout.borderRadiusSm,
    alignSelf: 'flex-start',
  },
  comparisonGood: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
  },
  comparisonBad: {
    backgroundColor: 'rgba(244, 67, 54, 0.15)',
  },
  comparisonText: {
    fontSize: typography.micro.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  comparisonTextGood: {
    color: colors.success,
  },
  comparisonTextBad: {
    color: colors.error,
  },
  contextText: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
  },
});
