/**
 * The line that says a read of the library failed.
 *
 * A read that answers nothing and a read that throws are different states: the
 * first is an empty library or a missing record, the second is the engine
 * refusing. A surface that draws the empty state for both shows the athlete a
 * library with nothing in it when the engine was only busy.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app/useTheme';
import { engineErrorKey } from '@/shared/native/engineError';
import { colors, darkColors, spacing, typography } from '@/theme';

interface EngineReadFailureProps {
  /** What the read threw. */
  error: unknown;
  testID: string;
}

export function EngineReadFailure({ error, testID }: EngineReadFailureProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  return (
    <Text
      testID={testID}
      style={[styles.text, { color: isDark ? darkColors.textSecondary : colors.textSecondary }]}
    >
      {t(engineErrorKey(error, 'engine.failure.database'))}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    fontSize: typography.caption.fontSize,
    paddingVertical: spacing.xs,
  },
});
