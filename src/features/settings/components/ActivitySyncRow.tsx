/**
 * Running activity sync, with the stop the engine has always supported.
 *
 * `SyncManager.cancel` sets a flag the sync loop reads between batches, so the
 * run stops dispatching new work rather than dying mid-request. That takes a
 * moment to land, which is why the button latches into a stopping state instead
 * of staying pressable: a second cancel would do nothing and read as a wedge.
 * The latch clears on the next run, not on the settle, so a sync started right
 * after a cancelled one is stoppable too.
 */

import React, { useCallback, useState } from 'react';
import { SyncState } from 'veloqrs';
import { View, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { getEngine } from '@/shared/native/engine';
import { useSyncStatus } from '@/shared/native/useSyncStatus';
import { useLibraryCoverage } from '@/shared/native/useLibraryCoverage';
import { formatLibraryCoverage } from '@/shared/format/libraryCoverage';
import { formatSyncProgress } from '@/shared/format/syncProgress';
import { colors, darkColors, typography } from '@/theme';
import { Row, pressable, pressRipple } from '@/shared/ui';
import { freshLoginTimeline } from '@/shared/debug/freshLoginTimeline';

export function ActivitySyncRow() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const status = useSyncStatus();
  const coverage = useLibraryCoverage();
  const isSyncing = status?.state === SyncState.Syncing;
  const [stopping, setStopping] = useState(false);
  const [wasSyncing, setWasSyncing] = useState(isSyncing);

  // A fresh run clears the latch, adjusted during render rather than in an
  // effect so the next sync's first frame already offers the stop.
  if (isSyncing !== wasSyncing) {
    setWasSyncing(isSyncing);
    if (isSyncing) setStopping(false);
  }

  const stop = useCallback(() => {
    if (stopping) return;
    setStopping(true);
    freshLoginTimeline.markCancelRequested();
    getEngine()?.cancelSync();
  }, [stopping]);

  if (!isSyncing) return null;

  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  // The run's own queue, then the library it is a slice of: a run that has
  // fetched everything it queued is not a library that is fully downloaded.
  const libraryLines = formatLibraryCoverage(coverage, t);

  return (
    <Row testID="activity-sync-row">
      <ActivityIndicator size="small" color={textSecondary} />
      <View style={styles.labels}>
        <Text style={[styles.label, { color: textSecondary }]} testID="sync-progress-label">
          {formatSyncProgress(status, t)}
        </Text>
        {libraryLines.length > 0 && (
          <View testID="sync-library-coverage">
            {libraryLines.map((line) => (
              <Text key={line} style={[styles.library, { color: textSecondary }]}>
                {line}
              </Text>
            ))}
          </View>
        )}
      </View>
      <Pressable
        onPress={stop}
        disabled={stopping}
        accessibilityRole="button"
        testID="sync-stop-button"
        style={pressable()}
        android_ripple={pressRipple}
      >
        <Text
          style={[
            styles.stop,
            isDark && { color: darkColors.linkTeal },
            stopping && { color: textSecondary },
          ]}
          testID="sync-stop-label"
        >
          {stopping ? t('settings.syncStopping') : t('settings.syncStop')}
        </Text>
      </Pressable>
    </Row>
  );
}

const styles = StyleSheet.create({
  labels: {
    flex: 1,
  },
  label: {
    ...typography.bodySmall,
  },
  library: {
    ...typography.caption,
  },
  stop: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.linkTeal,
  },
});
