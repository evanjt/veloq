import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing } from '@/theme';

const INSIGHT_ITEMS = [
  { icon: 'trophy-outline', label: 'Section PRs', color: '#F59E0B' },
  { icon: 'heart-pulse', label: 'Efficiency trends', color: '#EC4899' },
  { icon: 'lightning-bolt', label: 'Fitness milestones', color: '#8B5CF6' },
  { icon: 'trending-up', label: 'HRV trends', color: '#22C55E' },
];

export function InsightsSlide() {
  const { isDark } = useTheme();
  const mutedColor = isDark ? darkColors.textMuted : colors.textMuted;
  const bgColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  return (
    <View style={styles.container}>
      {INSIGHT_ITEMS.map((item) => (
        <View key={item.label} style={[styles.row, { backgroundColor: bgColor }]}>
          <MaterialCommunityIcons
            name={item.icon as keyof typeof MaterialCommunityIcons.glyphMap}
            size={20}
            color={item.color}
          />
          <Text style={[styles.label, { color: mutedColor }]}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
  },
});
