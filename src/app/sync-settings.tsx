import React from 'react';
import { StyleSheet } from 'react-native';
import { ScreenSafeAreaView, ScreenScrollView } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing } from '@/theme';
import { ActivitySyncRow, BackgroundJobsActivityBar, SyncRangePanel } from '@/features/settings';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

function SyncSettingsScreenContent() {
  const { isDark } = useTheme();

  return (
    <ScreenSafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      <ScreenScrollView
        contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing.xl }}
      >
        <BackgroundJobsActivityBar />
        <ActivitySyncRow />

        <SyncRangePanel />
      </ScreenScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfacePage,
  },
  containerDark: {
    backgroundColor: darkColors.surfacePage,
  },
});

export default withScreenBoundary(SyncSettingsScreenContent, 'SyncSettings');
