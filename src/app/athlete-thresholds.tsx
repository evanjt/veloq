import React from 'react';
import { StyleSheet } from 'react-native';
import { ScreenSafeAreaView, ScreenScrollView } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing } from '@/theme';
import { AthleteThresholds } from '@/features/settings';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

function AthleteThresholdsScreenContent() {
  const { isDark } = useTheme();
  return (
    <ScreenSafeAreaView
      testID="athlete-thresholds-screen"
      style={[styles.container, isDark && styles.containerDark]}
    >
      <ScreenScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
        <AthleteThresholds />
      </ScreenScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfacePage },
  containerDark: { backgroundColor: darkColors.surfacePage },
});

export default withScreenBoundary(AthleteThresholdsScreenContent, 'AthleteThresholds');
