import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { formatRelativeDate } from '@/shared/format/format';
import { colors, darkColors, spacing, typography } from '@/theme';
import type { CurveFreshness } from '../lib/curveFreshness';

interface CurveFreshnessLineProps {
  freshness: CurveFreshness;
}

/**
 * One quiet line dating the curve above it: the reading stays on screen and says
 * how old it is, rather than being dropped for being old.
 */
export function CurveFreshnessLine({ freshness }: CurveFreshnessLineProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  if (!freshness) return null;

  const text =
    freshness.kind === 'dated'
      ? t('statsScreen.curveFetched', {
          date: formatRelativeDate(new Date(freshness.fetchedAt).toISOString()),
        })
      : t('statsScreen.curveNotDownloaded');

  return (
    <Text testID="curve-freshness" style={[styles.line, isDark && styles.lineDark]}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  line: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  lineDark: {
    color: darkColors.textSecondary,
  },
});
