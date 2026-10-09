import React from 'react';
import { StyleSheet } from 'react-native';
import { ScreenSafeAreaView, ScreenScrollView, useTabBarClearance } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing } from '@/theme';
import { BackgroundJobsActivityBar, DataCacheSection } from '@/features/settings';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

function CacheSettingsScreenContent() {
  const { isDark } = useTheme();
  const tabBarClearance = useTabBarClearance();

  return (
    <ScreenSafeAreaView hasNativeHeader style={[styles.container, isDark && styles.containerDark]}>
      <ScreenScrollView contentContainerStyle={{ paddingBottom: spacing.xl + tabBarClearance }}>
        <BackgroundJobsActivityBar />
        <DataCacheSection />
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

export default withScreenBoundary(CacheSettingsScreenContent, 'CacheSettings');
