import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';

import { useTheme } from '@/shared/app';
import type { ExplainerInput } from '@/shared/app/explainer';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { SheetHeader } from '@/shared/ui';
import { tapBack } from '@/shared/app/navigation';
import { layout, type Palette, spacing, themedStyles, typography } from '@/theme';

/** An explanation of how something works, a sheet route opened with `openExplainer` that returns nothing. */

function ExplainerSheetContent() {
  const { isDark } = useTheme();
  const styles = themedStyles(makeStyles, isDark);
  const { input } = useSheetRequest<ExplainerInput, never>();
  if (!input) return null;

  const paragraphs = input.body.split(/\n\s*\n/).filter((paragraph) => paragraph.trim() !== '');

  return (
    <View testID="explainer-sheet" style={styles.sheet}>
      <SheetHeader title={input.title} onClose={() => tapBack()} />
      <View style={styles.body}>
        {paragraphs.map((paragraph, i) => (
          <Text key={i} style={styles.paragraph}>
            {paragraph.trim()}
          </Text>
        ))}
      </View>
    </View>
  );
}

export default withScreenBoundary(ExplainerSheetContent, 'Explainer');

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    sheet: {
      paddingBottom: layout.screenPadding,
    },
    body: {
      paddingHorizontal: layout.screenPadding,
      gap: spacing.sm,
    },
    paragraph: {
      ...typography.body,
      color: palette.textPrimary,
    },
  });
