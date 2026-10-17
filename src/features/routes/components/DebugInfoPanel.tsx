import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, darkColors, spacing, layout, typography, stroke } from '@/theme';

interface DebugInfoPanelProps {
  entries: { label: string; value: string }[];
  isDark: boolean;
}

export function DebugInfoPanel({ entries, isDark }: DebugInfoPanelProps) {
  return (
    <View
      style={[
        styles.container,
        { borderColor: isDark ? darkColors.border : colors.divider },
        isDark && styles.containerDark,
      ]}
    >
      <Text style={[styles.title, isDark && styles.titleDark]}>Debug Info</Text>
      {entries.map((entry) => (
        <View key={entry.label} style={styles.row}>
          <Text style={[styles.label, isDark && styles.textSecondary]}>{entry.label}</Text>
          <Text
            testID={`debug-value-${entry.label}`}
            style={[styles.value, isDark && styles.valueDark]}
          >
            {entry.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    borderWidth: stroke.one,
    backgroundColor: colors.surface,
  },
  containerDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  title: {
    ...typography.label,
    fontFamily: typography.code.fontFamily,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  titleDark: {
    color: darkColors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xxs,
  },
  label: {
    fontSize: typography.caption.fontSize,
    fontFamily: typography.code.fontFamily,
    color: colors.textSecondary,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
  value: {
    fontSize: typography.caption.fontSize,
    fontFamily: typography.code.fontFamily,
    color: colors.textPrimary,
  },
  valueDark: {
    color: colors.textOnDark,
  },
});
