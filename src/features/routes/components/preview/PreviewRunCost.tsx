/**
 * What the run just cost, and what it covered.
 *
 * The engine already measures both: `PreviewPayload` carries the loaded pool
 * and the elapsed time and they crossed the FFI with nothing reading them, so
 * a run over a whole riding area looked identical to a run over three rides.
 *
 * The scope line sits with them because it is the same fact. The picker
 * chooses a centre and the run covers the geographic component connected to
 * it, which is a correctness requirement rather than a shortcut, so the copy
 * has to say it: the area box on the map implies the opposite.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, typography } from '@/theme';
import type { PreviewResult } from '../../../../../modules/veloqrs/src/delegates/preview';

interface PreviewRunCostProps {
  pool: PreviewResult['pool'];
  elapsedMs: number;
}

/** Milliseconds under a second, so a fast run does not read as `0.0 s`. */
function formatElapsed(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function PreviewRunCost({ pool, elapsedMs }: PreviewRunCostProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const secondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View style={styles.wrap}>
      <Text style={[styles.line, { color: secondary }]} testID="preview-run-cost">
        {t('settings.previewPoolCost', {
          count: pool.activities,
          duration: formatElapsed(elapsedMs),
        })}
      </Text>
      <Text style={[styles.line, { color: secondary }]} testID="preview-run-scope">
        {t('settings.previewPoolScope')}
      </Text>
      {pool.unreadable > 0 && (
        <Text style={[styles.line, { color: secondary }]} testID="preview-run-unreadable">
          {t('settings.previewPoolUnreadable', { count: pool.unreadable })}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.chart.xs,
    paddingHorizontal: spacing.xs,
  },
  line: {
    ...typography.caption,
  },
});
