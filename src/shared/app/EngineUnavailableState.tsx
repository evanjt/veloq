/**
 * What a screen draws in place of a read the engine cannot answer.
 *
 * A closed engine answers every read with its empty default, so a list that
 * renders those rows tells the athlete their library is gone when it is on
 * the device untouched. A screen asks `useEngineReadState` first and draws
 * this for anything but `ready`.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { EmptyState, Shimmer } from '@/shared/ui';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { engineInitReasonLine, engineRecoveryActions } from '@/shared/app/engineInitReason';
import type { EngineReadState } from '@/shared/native/useEngineSubscription';
import { layout, spacing } from '@/theme';

/**
 * The engine gave up opening: the reason it recorded, and the first recovery
 * the banner offers for it. Where that is Retry it re-runs the root layout's
 * whole init, not a re-read of a handle that is still closed.
 */
export function EngineUnavailableState() {
  const { t } = useTranslation();
  const reason = useEngineStatus((s) => s.initFailureReason);
  const shortfall = useEngineStatus((s) => s.storageShortfall);
  const requestRetry = useEngineStatus((s) => s.requestRetry);
  const action = engineRecoveryActions(reason, t, requestRetry)[0];
  return (
    <View testID="engine-unavailable">
      <EmptyState
        icon="alert-circle-outline"
        title={engineInitReasonLine(reason, shortfall, t)}
        actionLabel={action?.label}
        onAction={action?.onPress}
      />
    </View>
  );
}

const PLACEHOLDER_ROWS = [0, 1, 2];
/** About one list card: a footprint preview and two lines beside it. */
const PLACEHOLDER_ROW_HEIGHT = 64;

/**
 * A list screen's body while its read cannot be believed: rows shimmering
 * while the engine opens, the failure once it has given up.
 */
export function EngineReadPlaceholder({ state }: { state: Exclude<EngineReadState, 'ready'> }) {
  if (state === 'failed') return <EngineUnavailableState />;
  return (
    <View testID="engine-read-placeholder" style={styles.rows}>
      {PLACEHOLDER_ROWS.map((i) => (
        <Shimmer key={i} height={PLACEHOLDER_ROW_HEIGHT} borderRadius={layout.borderRadius} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { gap: spacing.sm },
});
