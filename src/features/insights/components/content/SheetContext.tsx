import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/shared/app';
import { Card } from '@/shared/ui';
import { spacing, themePalette, typography } from '@/theme';

interface SheetContextProps {
  heading?: string | undefined;
  body?: string | undefined;
  meta?: string | undefined;
}

/**
 * What an insight sheet's numbers compare, above its rows. It is read, never
 * pressed, so it is the flat card, titled in the card title role, the body in
 * the compact body role and the note on where to look next as a caption.
 */
export function SheetContext({ heading, body, meta }: SheetContextProps) {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);

  return (
    <Card variant="flat" testID="sheet-context" title={heading} style={styles.stack}>
      {body ? <Text style={[styles.body, { color: palette.textPrimary }]}>{body}</Text> : null}
      {meta ? <Text style={[styles.meta, { color: palette.textSecondary }]}>{meta}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.xs },
  body: { ...typography.bodyCompact },
  meta: { ...typography.caption },
});
