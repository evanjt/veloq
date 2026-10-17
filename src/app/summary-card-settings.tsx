import React from 'react';
import { StyleSheet } from 'react-native';
import { ScreenSafeAreaView, ScreenScrollView } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing } from '@/theme';
import { SummaryCardSection } from '@/features/settings';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

function SummaryCardSettingsScreenContent() {
  const { isDark } = useTheme();

  return (
    <ScreenSafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      <ScreenScrollView
        contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing.xl }}
      >
        <SummaryCardSection />
      </ScreenScrollView>
    </ScreenSafeAreaView>
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
});

export default withScreenBoundary(SummaryCardSettingsScreenContent, 'SummaryCardSettings');
