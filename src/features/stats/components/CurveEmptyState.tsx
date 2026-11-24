import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { RangeCoverage } from 'veloqrs';
import { typography, themedStyles, type Palette } from '@/theme';
import { useTheme } from '@/shared/app';
import { BodyNotDownloaded, EmptyState } from '@/shared/ui';
import type { EngineBodyStatus } from '@/shared/native/engineBodies';

interface CurveEmptyStateProps {
  coverage: RangeCoverage;
  bodyStatus: EngineBodyStatus;
  onRetry: () => void;
  plotHeight: number;
  /** Prefix of the not-downloaded test id, as in `power-curve`. */
  testIDPrefix: string;
  /** Shown once the range is known to hold no curve. */
  emptyTitle: string;
}

/** What a curve chart shows in place of its plot: the range is not downloaded, or holds no curve. */
export function CurveEmptyState({
  coverage,
  bodyStatus,
  onRetry,
  plotHeight,
  testIDPrefix,
  emptyTitle,
}: CurveEmptyStateProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const styles = themedStyles(makeStyles, isDark);
  return (
    <View style={{ minHeight: plotHeight }}>
      <View style={styles.emptyState}>
        {coverage === RangeCoverage.NotFetched ? (
          <BodyNotDownloaded
            testID={`${testIDPrefix}-not-downloaded`}
            style={styles.notDownloaded}
            textStyle={styles.notDownloadedText}
            message={t('stats.rangeNotDownloaded')}
            status={bodyStatus}
            onRetry={onRetry}
          />
        ) : (
          <EmptyState variant="inline" title={emptyTitle} />
        )}
      </View>
    </View>
  );
}

const makeStyles = (palette: Palette) => ({
  emptyState: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  notDownloaded: {
    alignItems: 'center' as const,
  },
  notDownloadedText: {
    ...typography.bodyCompact,
    color: palette.textSecondary,
  },
});
