import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/hooks';
import { colors, darkColors } from '@/theme';

interface SettingsSectionProps {
  children: React.ReactNode;
}

export function SettingsSection({ children }: SettingsSectionProps) {
  const { isDark } = useTheme();

  return <View style={[styles.section, isDark && styles.sectionDark]}>{children}</View>;
}

export function SectionDivider() {
  const { isDark } = useTheme();

  return <View style={[styles.divider, isDark && styles.dividerDark]} />;
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
  },
  sectionDark: {
    backgroundColor: darkColors.surface,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginLeft: 16,
  },
  dividerDark: {
    backgroundColor: darkColors.divider,
  },
});
