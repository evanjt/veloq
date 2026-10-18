import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/shared/app';
import { SectionLapsCard } from '@/features/routes';
import { ScreenScrollView } from '@/shared/ui';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { colors, darkColors, layout, spacing } from '@/theme';

/** A section's laps on its own screen, opened from outside a map sheet or by a link. */
function SectionLapsScreen() {
  const { id, range, sport } = useLocalSearchParams<{
    id: string;
    range?: string;
    sport?: string;
  }>();
  return <SectionLapsCard id={id} range={range} sport={sport} Scroll={ScreenScroll} />;
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

export default withScreenBoundary(SectionLapsScreen, 'Section Laps');
