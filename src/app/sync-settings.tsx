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
    <ScreenSafeAreaView hasNativeHeader style={[styles.container, isDark && styles.containerDark]}>
      <ScreenScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
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
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: darkColors.background,
  },
});

export default withScreenBoundary(SyncSettingsScreenContent, 'SyncSettings');
