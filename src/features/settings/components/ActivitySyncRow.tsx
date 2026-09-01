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
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { getEngine } from '@/shared/native/engine';
import { useSyncStatus } from '@/shared/native/useSyncStatus';
import { colors, darkColors, spacing, typography } from '@/theme';

export function ActivitySyncRow() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const status = useSyncStatus();
  const isSyncing = status?.state === 'syncing';
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
    getEngine()?.cancelSync();
  }, [stopping]);

  if (!isSyncing) return null;

  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const total = status?.total ?? 0;

  return (
    <View style={styles.row} testID="activity-sync-row">
      <ActivityIndicator size="small" color={textSecondary} />
      <Text style={[styles.label, { color: textSecondary }]} testID="sync-progress-label">
        {total > 0
          ? t('settings.syncActivitiesProgress', { completed: status?.completed ?? 0, total })
          : t('settings.syncActivities')}
      </Text>
      <TouchableOpacity
        onPress={stop}
        disabled={stopping}
        accessibilityRole="button"
        testID="sync-stop-button"
      >
        <Text style={[styles.stop, stopping && { color: textSecondary }]} testID="sync-stop-label">
          {stopping ? t('settings.syncStopping') : t('settings.syncStop')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  label: {
    ...typography.bodySmall,
    flex: 1,
  },
  stop: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.primary,
  },
});
