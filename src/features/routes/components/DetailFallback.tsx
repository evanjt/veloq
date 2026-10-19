/**
 * Fallback screen for route/section detail: skeleton while the engine is
 * still opening, the Peek blocks on a card whose Peek is what lands, the engine's reason and its recovery once it has given up,
 * the not-found text when the item is missing, and a failure message with
 * Retry when the read failed. There is no hero to lay a transparent header
 * over, so it takes the opaque header and the content starts directly beneath
 * it.
 */

import { useMemo } from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ChartSkeleton, EmptyState } from '@/shared/ui';
import { MapDetailPeekSkeleton } from '@/shared/ui/MapDetailSkeleton';
import { engineErrorKey } from '@/shared/native/engineError';
import { useEngineReadState } from '@/shared/native/useEngineSubscription';
import { EngineUnavailableState } from '@/shared/app/EngineUnavailableState';
import type { DetailReadStatus } from '../lib/detailReadResult';
import { colors, darkColors, spacing } from '@/theme';
import { noHeroHeaderOptions } from '@/shared/app/screenHeaders';

interface DetailFallbackProps {
  isDark: boolean;
  /** The read's outcome: only `missing` shows the not-found text. */
  status: DetailReadStatus;
  notFoundMessage: string;
  /** A missing record the ledger knows: how it left, and where it went when that is live. */
  retired?:
    | { title: string; linkLabel?: string | undefined; onOpenLink?: (() => void) | undefined }
    | undefined;
  /** Re-runs the read after a failure. */
  onRetry: () => void;
  /** The map screen whose card this is, which stands at Peek while the read is pending. */
  peek?: 'route' | 'section';
}

export function DetailFallback({
  isDark,
  status,
  notFoundMessage,
  retired,
  onRetry,
  peek,
}: DetailFallbackProps) {
  const { t } = useTranslation();
  const headerOptions = useMemo(() => noHeroHeaderOptions({ isDark, os: Platform.OS }), [isDark]);
  // A closed read is the engine's answer, not the record's: the engine says
  // whether it is still opening or has given up, never the caller.
  const engine = useEngineReadState();
  const closedEngine = status.kind === 'closed' ? engine : 'ready';

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <Stack.Screen options={headerOptions} />
      {closedEngine === 'closed' && peek ? (
        <MapDetailPeekSkeleton kind={peek} />
      ) : closedEngine === 'closed' ? (
        <View testID="detail-fallback-skeleton" style={styles.skeletonWrap}>
          <ChartSkeleton height={280} />
          <ChartSkeleton height={200} />
        </View>
      ) : (
        <View style={styles.emptyWrap}>
          {closedEngine === 'failed' ? (
            <EngineUnavailableState />
          ) : status.kind === 'missing' && retired ? (
            <EmptyState
              icon="map-marker-question-outline"
              title={retired.title}
              actionLabel={retired.linkLabel}
              onAction={retired.onOpenLink}
            />
          ) : status.kind === 'missing' ? (
            <EmptyState icon="map-marker-question-outline" title={notFoundMessage} />
          ) : (
            <EmptyState
              icon="alert-circle-outline"
              title={t(
                engineErrorKey(
                  status.kind === 'failed' ? status.error : undefined,
                  'engine.failure.notOpen'
                )
              )}
              actionLabel={t('common.retry')}
              onAction={onRetry}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfacePage,
  },
  containerDark: {
    backgroundColor: darkColors.surfacePage,
  },
  skeletonWrap: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
  },
});
