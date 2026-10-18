import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/shared/app';
import { SectionHistoryCard } from '@/features/routes';
import { ScreenScrollView } from '@/shared/ui';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { colors, darkColors, layout, spacing } from '@/theme';

/** A section's history on its own screen, opened from outside a map sheet or by a link. */
function SectionHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SectionHistoryCard id={id} Scroll={ScreenScroll} />;
}

/** The screen's own scroll under its stack header, on the page's ground. */
function ScreenScroll({ children }: { children: React.ReactNode }) {
  const { isDark } = useTheme();
  return (
    <View style={[styles.screen, isDark && styles.screenDark]}>
      <ScreenScrollView contentContainerStyle={styles.content}>{children}</ScreenScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfacePage },
  screenDark: { backgroundColor: darkColors.surfacePage },
  content: { padding: layout.screenPadding, paddingBottom: spacing.xl },
});

export default withScreenBoundary(SectionHistoryScreen, 'Section History');
