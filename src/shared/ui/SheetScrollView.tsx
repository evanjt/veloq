/**
 * The root of a sheet route whose body scrolls, painting the sheet's surface.
 *
 * The iOS form sheet sizes a scroll view that is the first view of its content. It also follows
 * the first child of each view down from the content, and a scroll view met deeper on that path
 * gets the sheet's own frame as its frame, in the coordinates of the view around it, which moves
 * it out of sight and leaves the sheet blank. So the scroll view is the root, and nothing wraps
 * it to carry the background.
 */

import React, { forwardRef } from 'react';
import { ScrollView, StyleSheet, type ScrollViewProps } from 'react-native';

import { useTheme } from '@/shared/app';
import { colors, darkColors } from '@/theme';

export const SheetScrollView = forwardRef<ScrollView, Omit<ScrollViewProps, 'style'>>(
  function SheetScrollView(props, ref) {
    const { isDark } = useTheme();
    return <ScrollView ref={ref} style={[styles.sheet, isDark && styles.sheetDark]} {...props} />;
  }
);

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  sheetDark: {
    backgroundColor: darkColors.surface,
  },
});
