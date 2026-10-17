import React from 'react';
import { StyleSheet } from 'react-native';
import { ScreenSafeAreaView, ScreenScrollView } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { useAthlete } from '@/shared/app/useAthlete';
import { colors, darkColors, spacing } from '@/theme';
import { ProfileAccountSection } from '@/features/settings';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

function AccountScreenContent() {
  const { isDark } = useTheme();
  const { data: athleteRow } = useAthlete();
  const athlete = athleteRow ?? undefined;

  return (
    <ScreenSafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      <ScreenScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
        <ProfileAccountSection athlete={athlete} />
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

export default withScreenBoundary(AccountScreenContent, 'Account');
