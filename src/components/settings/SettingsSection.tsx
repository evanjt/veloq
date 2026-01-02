import React from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { useTranslation } from 'react-i18next';

interface SettingsSectionProps {
  children: React.ReactNode;
}

export function SettingsSection({ children }: SettingsSectionProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <View style={[styles.section, isDark && styles.sectionDark]}>
      {children}
    </View>
  );
}

export function SectionDivider() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return <View style={[styles.divider, isDark && styles.dividerDark]} />;
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
  },
  sectionDark: {
    backgroundColor: '#1c1c1e',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    marginLeft: 16,
  },
  dividerDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
});
