/**
 * One line on the feed while the engine is syncing.
 *
 * The sync tray notification is gone, and what replaced it, the map tab's
 * `SyncProgressBanner`, is on a screen a first launch never reaches. So the
 * feed filled in silence and read as a crash. This says a sync is running and
 * nothing else: the counts are the engine's own, and the line goes when the
 * sync settles.
 */

import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { SyncState } from 'veloqrs';

import { useTheme } from '@/shared/app';
import { formatSyncProgress } from '@/shared/format/syncProgress';
import { useSyncStatus } from '@/shared/native/useSyncStatus';
import { colors, darkColors, spacing, typography } from '@/theme';

export function FeedSyncLine() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const status = useSyncStatus();

  if (status?.state !== SyncState.Syncing) return null;

  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View style={styles.row} testID="feed-sync-line">
      <ActivityIndicator size="small" color={textSecondary} />
      <Text style={[styles.label, { color: textSecondary }]} testID="feed-sync-message">
        {formatSyncProgress(status, t)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  label: {
    fontSize: typography.bodyCompact.fontSize,
  },
});
