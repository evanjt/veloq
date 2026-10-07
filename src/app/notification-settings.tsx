import React from 'react';
import { StyleSheet, ScrollView } from 'react-native';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing } from '@/theme';
import { NotificationSection } from '@/features/settings/components';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

function NotificationSettingsScreenContent() {
  const { isDark } = useTheme();

  return (
    <ScreenSafeAreaView hasNativeHeader style={[styles.container, isDark && styles.containerDark]}>
      <ScrollView contentContainerStyle={styles.content}>
        <NotificationSection />
      </ScrollView>
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
  content: {
    paddingBottom: spacing.xl + TAB_BAR_SAFE_PADDING,
  },
});

export default withScreenBoundary(NotificationSettingsScreenContent, 'NotificationSettings');
