/**
 * The map credit as the first line inside a map sheet, under its handle or grabber, in the sheet's
 * own text colour. It is a child of the sheet, so it moves with every frame of a drag. The text
 * wraps rather than truncates: the credit is a licence condition.
 */
import React from 'react';
import { StyleSheet } from 'react-native';

import { useMapSheetCredit } from '@/shared/app/mapSheetCredit';
import { useTheme } from '@/shared/app/useTheme';
import { colors, darkColors, spacing, typography } from '@/theme';

import { DenseText } from './DenseText';

export function MapSheetCreditLine({ sheetKey }: { sheetKey: string }) {
  const text = useMapSheetCredit(sheetKey);
  const { isDark } = useTheme();
  if (!text) return null;
  return (
    <DenseText
      testID="map-attribution-text"
      style={[styles.text, { color: (isDark ? darkColors : colors).textSecondary }]}
    >
      {text}
    </DenseText>
  );
}

const styles = StyleSheet.create({
  text: {
    ...typography.micro,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
    textAlign: 'right',
  },
});
