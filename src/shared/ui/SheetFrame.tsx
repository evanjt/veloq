/**
 * The frame every sheet route renders inside, put there by the root stack's
 * `screenLayout` rather than by each route.
 *
 * It is the sheet's only fill, painting the surface except where the system
 * draws the sheet's own material (`sheetSurface`), draws Material's drag handle
 * where Android's stack sheet has none, and pads the content clear of the
 * bottom inset. `sheetFrame` decides those two per route and platform. The handle is decorative:
 * the stack sheet takes no detent from JavaScript after it opens, so the
 * handle has no action to offer a screen reader, and scrolling the content
 * expands the sheet while back dismisses it. A map sheet moves between its stops
 * by being presented again, so it draws `MapSheetHandle` instead.
 */

import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/shared/app';
import {
  SCREEN_SHEETS,
  sheetFrame,
  sheetHasDetents,
  sheetSurface,
} from '@/shared/app/screenHeaders';
import { colors, darkColors, layout, spacing } from '@/theme';

export function SheetFrame({ name, children }: { name: string; children: React.ReactNode }) {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { handle, paddingBottom } = sheetFrame(name, Platform.OS, insets.bottom);
  const palette = isDark ? darkColors : colors;

  return (
    <View
      testID="sheet-frame"
      style={[
        sheetHasDetents(name) && styles.fill,
        { backgroundColor: sheetSurface(Platform.OS, Platform.Version, isDark), paddingBottom },
      ]}
    >
      {handle ? (
        <View
          testID="sheet-handle"
          style={styles.handleArea}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View style={[styles.handle, { backgroundColor: palette.track }]} />
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** A sheet route renders inside `SheetFrame`, any other as it is. Part of `rootScreenLayout`. */
export function sheetScreenLayout({
  route,
  children,
}: {
  route: { name: string };
  children: React.ReactElement;
}): React.ReactElement {
  if (!SCREEN_SHEETS[route.name]) return children;
  return <SheetFrame name={route.name}>{children}</SheetFrame>;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  // Material's drag handle, 32 by 4, in the colour of a slider's track.
  handle: {
    width: spacing.xl,
    height: spacing.xs,
    borderRadius: layout.borderRadiusFull,
  },
});
