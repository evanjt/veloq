/**
 * What the feed shows on a first launch, while the library is still empty.
 *
 * A fresh install used to land on "No activities" over a summary card of
 * zeros, with a download cloud on every card that arrived, for as long as the
 * first sync took. The query resolves empty long before anything is stored, so
 * nothing on the screen was a loading state. This says what is happening and
 * carries the engine's own counts, and it is gone the moment the first cards
 * land.
 */

import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { formatSyncProgress } from '@/shared/format/syncProgress';
import { useSyncStatus } from '@/shared/native/useSyncStatus';
import { colors, darkColors, spacing, typography } from '@/theme';

export function FeedFirstSyncStandby() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const status = useSyncStatus();

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View style={styles.container} testID="feed-first-sync-standby">
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.title, { color: textPrimary }]} testID="feed-first-sync-title">
        {t('feed.firstSyncTitle')}
      </Text>
      <Text style={[styles.body, { color: textSecondary }]} testID="feed-first-sync-body">
        {t('feed.firstSyncBody')}
      </Text>
      {status?.step !== undefined && (
        <Text style={[styles.step, { color: textSecondary }]} testID="feed-first-sync-step">
          {formatSyncProgress(status, t)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  title: {
    fontSize: typography.sectionTitle.fontSize,
    fontWeight: typography.sectionTitle.fontWeight,
    textAlign: 'center',
  },
  body: {
    fontSize: typography.bodyCompact.fontSize,
    textAlign: 'center',
  },
  step: {
    fontSize: typography.bodyCompact.fontSize,
    textAlign: 'center',
  },
});
