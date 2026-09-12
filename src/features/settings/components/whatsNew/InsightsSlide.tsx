import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, layout, typography, colorWithOpacity, ink } from '@/theme';

const insightItems = (isDark: boolean) => [
  {
    icon: 'trophy-outline',
    label: 'Section PRs',
    color: isDark ? darkColors.warningAmber : colors.warningAmber,
  },
  { icon: 'heart-pulse', label: 'Efficiency trends', color: colors.chartHrv },
  { icon: 'lightning-bolt', label: 'Fitness milestones', color: colors.walk },
  {
    icon: 'trending-up',
    label: 'HRV trends',
    color: isDark ? darkColors.successDeep : colors.successDeep,
  },
];

export function InsightsSlide() {
  const { isDark } = useTheme();
  const mutedColor = isDark ? darkColors.textMuted : colors.textMuted;
  const bgColor = isDark ? colorWithOpacity(ink.white, 0.06) : colorWithOpacity(ink.black, 0.04);

  return (
    <View style={styles.container}>
      {insightItems(isDark).map((item) => (
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
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: layout.borderRadiusMd,
  },
  label: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
  },
});
