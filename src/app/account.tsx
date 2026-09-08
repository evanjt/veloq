import React from 'react';
import { StyleSheet, ScrollView } from 'react-native';
import { ScreenSafeAreaView, ScreenErrorBoundary, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { useAthlete } from '@/shared/app/useAthlete';
import { colors, darkColors, spacing } from '@/theme';
import { ProfileAccountSection } from '@/features/settings/components';

export default function AccountScreen() {
  const { isDark } = useTheme();
  const { data: athleteRow } = useAthlete();
  const athlete = athleteRow ?? undefined;

  return (
    <ScreenErrorBoundary screenName="Account">
      <ScreenSafeAreaView
        hasNativeHeader
        style={[styles.container, isDark && styles.containerDark]}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <ProfileAccountSection athlete={athlete} />
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
