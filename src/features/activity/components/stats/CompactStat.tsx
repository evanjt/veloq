import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, darkColors, typography } from '@/theme';

interface CompactStatProps {
  label: string;
  value: string;
  isDark: boolean;
  color?: string;
}

export function CompactStat({ label, value, isDark, color }: CompactStatProps) {
  return (
    <View style={styles.item}>
      <Text
        style={[
          styles.value,
          isDark && { color: darkColors.textPrimary },
          color ? { color } : undefined,
        ]}
      >
        {value}
      </Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    alignItems: 'center',
    flex: 1,
  },
  value: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  label: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
