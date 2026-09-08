import React from 'react';
import { StyleSheet, ScrollView } from 'react-native';
import { ScreenSafeAreaView, ScreenErrorBoundary, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing } from '@/theme';
import { DataSourcesSection } from '@/features/settings/components';

export default function DataSourcesSettingsScreen() {
  const { isDark } = useTheme();

  return (
    <ScreenErrorBoundary screenName="DataSourcesSettings">
      <ScreenSafeAreaView
        hasNativeHeader
        style={[styles.container, isDark && styles.containerDark]}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <DataSourcesSection />
        </ScrollView>
      </ScreenSafeAreaView>
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: darkColors.background,
  },
  content: {
    paddingBottom: spacing.xl + TAB_BAR_SAFE_PADDING,
  },
  textLight: {
    color: colors.textOnDark,
  },
});
