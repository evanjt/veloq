/**
 * Fallback screen for route/section detail: skeleton while the engine is
 * still initialising, the not-found text when the item is missing, and a failure
 * message with Retry when the read failed or the engine is closed.
 */

import { View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ChartSkeleton, EmptyState, HERO_HEADER_HEIGHT } from '@/shared/ui';
import { engineErrorKey } from '@/shared/native/engineError';
import type { DetailReadStatus } from '../lib/detailReadResult';
import { colors, darkColors, spacing } from '@/theme';
import { overMapHeaderTint } from '@/shared/app/screenHeaders';

interface DetailFallbackProps {
  isDark: boolean;
  insetTop: number;
  /** The read's outcome: only `missing` shows the not-found text. */
  status: DetailReadStatus;
  /** True while the engine is not open yet, so a closed read shows the skeleton. */
  loading: boolean;
  notFoundMessage: string;
  /** A missing record the ledger knows: how it left, and where it went when that is live. */
  retired?:
    | { title: string; linkLabel?: string | undefined; onOpenLink?: (() => void) | undefined }
    | undefined;
  /** Re-runs the read after a failure. */
  onRetry: () => void;
}

export function DetailFallback({
  isDark,
  insetTop,
  status,
  loading,
  notFoundMessage,
  retired,
  onRetry,
}: DetailFallbackProps) {
  const { t } = useTranslation();

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <Stack.Screen options={{ headerTintColor: overMapHeaderTint({ overHero: false, isDark }) }} />
      <View style={{ height: insetTop + HERO_HEADER_HEIGHT }} />
      {status.kind === 'closed' && loading ? (
        <View style={styles.skeletonWrap}>
          <ChartSkeleton height={280} />
          <ChartSkeleton height={200} />
        </View>
      ) : (
        <View style={styles.emptyWrap}>
          {status.kind === 'missing' && retired ? (
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
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: darkColors.background,
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
