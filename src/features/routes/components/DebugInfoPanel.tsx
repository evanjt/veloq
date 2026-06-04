import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, darkColors, spacing } from '@/theme';

interface DebugInfoPanelProps {
  entries: Array<{ label: string; value: string }>;
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
          <Text style={[styles.label, isDark && styles.textMuted]}>{entry.label}</Text>
          <Text style={[styles.value, isDark && styles.valueDark]}>{entry.value}</Text>
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
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  containerDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  title: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  titleDark: {
    color: darkColors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  label: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: colors.textSecondary,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  value: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: colors.textPrimary,
  },
  valueDark: {
    color: colors.textOnDark,
  },
});
