/**
 * The first load as one line on the tour's chrome: shown while the sync runs, gone when it
 * settles. The tour is not a page about it, so the athlete is told the feed is filling in without
 * a slide spent on it.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { SyncState } from 'veloqrs';
import { useTheme } from '@/shared/app';
import { formatSyncProgressParts } from '@/shared/format/syncProgress';
import { useSyncStatus } from '@/shared/native/useSyncStatus';
import { colors, darkColors, spacing, typography } from '@/theme';

export function TourSyncLine() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const status = useSyncStatus();
  if (status?.state !== SyncState.Syncing) return null;

  const { counts } = formatSyncProgressParts(status, t);
  const line = t('whatsNew.tutorial.firstLoadLine') as string;
  return (
    <Text
      testID="tour-first-load-line"
      style={[styles.line, { color: isDark ? darkColors.textSecondary : colors.textSecondary }]}
    >
      {counts ? `${line} ${counts}` : line}
    </Text>
  );
}

const styles = StyleSheet.create({
  line: {
    ...typography.caption,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
});
