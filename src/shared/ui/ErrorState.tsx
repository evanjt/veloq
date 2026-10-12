/**
 * A read that failed, named and with a way to read again.
 *
 * A read that answers nothing and a read that throws are different states: the
 * first is an empty library or a missing record, the second is the engine
 * refusing. So every surface that shows a failure takes what was thrown, says
 * the engine's reason when it is the engine's, and offers the read again in
 * place. One component holds the label and the button weight, so a failure
 * reads the same on every screen.
 *
 * `screen` stands in for a whole screen or list and carries the primary button.
 * `inline` sits inside the card whose read failed, under a hero or beside other
 * content, and carries a small secondary one.
 */

import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';

import { useTheme } from '@/shared/app';
import { engineErrorKey } from '@/shared/native/engineError';
import { colors, darkColors, spacing, typography } from '@/theme';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { StatusLine } from './StatusLine';

export type ErrorStateVariant = 'screen' | 'inline';

interface ErrorStateProps {
  /** What the read threw. An engine failure names its own cause. */
  error: unknown;
  /** Reads again. */
  onRetry: () => void;
  /** The line for a failure that is not the engine's, such as a fetch that failed. */
  fallbackKey?: ParseKeys;
  variant?: ErrorStateVariant;
  /** The state's id; the retry takes it with `-retry` after it. */
  testID?: string;
  /** Placement only, such as the margin a screen gives what sits under its hero. */
  style?: StyleProp<ViewStyle>;
}

export function ErrorState({
  error,
  onRetry,
  fallbackKey = 'emptyState.error.description',
  variant = 'screen',
  testID = 'error-state',
  style,
}: ErrorStateProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const reason = t(engineErrorKey(error, fallbackKey));

  if (variant === 'screen') {
    return (
      <View testID={testID} style={style}>
        <EmptyState
          icon="alert-circle-outline"
          tone="error"
          title={t('emptyState.error.title')}
          description={reason}
          actionLabel={t('common.retry')}
          onAction={onRetry}
          actionTestID={`${testID}-retry`}
        />
      </View>
    );
  }

  return (
    <StatusLine tone="error" message={reason} testID={testID} style={[styles.inline, style]}>
      <Text
        style={[
          styles.inlineText,
          { color: isDark ? darkColors.textSecondary : colors.textSecondary },
        ]}
      >
        {reason}
      </Text>
      <RetryButton onPress={onRetry} testID={`${testID}-retry`} />
    </StatusLine>
  );
}

interface RetryButtonProps {
  onPress: () => void;
  testID?: string;
}

/**
 * The Retry that sits beside content that still reads. Only a state that
 * replaces the whole screen takes the primary weight, through `EmptyState`.
 */
export function RetryButton({ onPress, testID }: RetryButtonProps) {
  const { t } = useTranslation();
  return (
    <Button
      label={t('common.retry')}
      variant="secondary"
      size="sm"
      onPress={onPress}
      {...(testID ? { testID } : {})}
    />
  );
}

const styles = StyleSheet.create({
  inline: {
    alignItems: 'flex-start',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  inlineText: {
    fontSize: typography.caption.fontSize,
  },
});
