import React from 'react';
import { StyleSheet } from 'react-native';
import { ScreenSafeAreaView, ScreenScrollView } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { useAthlete } from '@/shared/app/useAthlete';
import { colors, darkColors, spacing } from '@/theme';
import { AccountConnectionsSection, ProfileAccountSection } from '@/features/settings';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

function AccountScreenContent() {
  const { isDark } = useTheme();
  const { data: athleteRow } = useAthlete();
  const athlete = athleteRow ?? undefined;

  return (
    <ScreenSafeAreaView
      testID="account-screen"
      style={[styles.container, isDark && styles.containerDark]}
    >
      <ScreenScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
        <ProfileAccountSection athlete={athlete} />
        <AccountConnectionsSection />
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

export default withScreenBoundary(AccountScreenContent, 'Account');
