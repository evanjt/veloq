/**
 * The end of a feed search that has run out on the device: an offer to search
 * the athlete's intervals.icu account, and the rows it finds that the device
 * does not hold.
 *
 * The rows are marked as not on the device and a tap downloads the activity
 * and opens it. The offer is never shown ahead of the local results.
 */

import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { FfiRemoteActivity } from 'veloqrs';

import { useMetricSystem, useTheme } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { formatDistance, formatDuration, formatShortDateWithYear } from '@/shared/format/format';
import { downloadRemoteActivity } from '@/shared/native/remoteActivitySearch';
import { Badge, Button, Card, InlineNotice, Spinner } from '@/shared/ui';
import { colors, darkColors, spacing, typography } from '@/theme';
import { useRemoteActivitySearch } from '../hooks/useRemoteActivitySearch';
import type { FeedFilter } from '../lib/feedFilter';
import { CARD_MARGIN } from '../lib/cardLayout';

interface Props {
  filter: FeedFilter;
  /** The local list has run out and the filter names something the account can be asked. */
  offered: boolean;
}

/** The server's local start, as a day. */
const dayOf = (startDateLocal: string) => startDateLocal.slice(0, 10);

function RemoteRow({ row, isMetric }: { row: FfiRemoteActivity; isMetric: boolean }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const open = useCallback(() => {
    downloadRemoteActivity(row.id);
    navigateTo(`/activity/${row.id}`);
  }, [row.id]);

  const facts = [
    row.startDateLocal
      ? formatShortDateWithYear(new Date(`${dayOf(row.startDateLocal)}T12:00:00`))
      : null,
    row.distance ? formatDistance(row.distance, isMetric) : null,
    row.movingTime ? formatDuration(row.movingTime) : null,
  ].filter(Boolean);
  const name = row.name || row.sportType;
  const ink = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <Card
      variant="flat"
      padding="sm"
      testID={`remote-activity-${row.id}`}
      accessibilityRole="button"
      accessibilityLabel={t('feed.remote.rowLabel', { name, facts: facts.join(', ') })}
      onPress={open}
      style={styles.row}
    >
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={2}>
          {name}
        </Text>
        <Text style={[styles.facts, { color: ink }]}>{facts.join(' · ')}</Text>
      </View>
      <Badge
        tone="neutral"
        size="sm"
        icon={getActivityIcon(row.sportType)}
        text={t('feed.remote.notOnDevice')}
        isDark={isDark}
        testID={`remote-activity-${row.id}-mark`}
      />
    </Card>
  );
}

export function FeedRemoteSearch({ filter, offered }: Props) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const { phase, rows, capped, run } = useRemoteActivitySearch(filter);
  const ink = isDark ? darkColors.textSecondary : colors.textSecondary;

  if (!offered || phase === 'unavailable') return null;

  return (
    <View testID="feed-remote-search" style={styles.container}>
      {phase === 'idle' && (
        <Button
          testID="feed-remote-search-offer"
          variant="secondary"
          size="md"
          icon="cloud-search-outline"
          label={t('feed.remote.offer')}
          onPress={run}
        />
      )}
      {phase === 'loading' && (
        <View style={styles.loading}>
          <Spinner label={t('feed.remote.searching')} />
          <Text style={[styles.facts, { color: ink }]}>{t('feed.remote.searching')}</Text>
        </View>
      )}
      {phase === 'failed' && (
        <InlineNotice tone="error" icon="cloud-alert-outline" title={t('feed.remote.failed')}>
          <Button
            testID="feed-remote-search-retry"
            variant="secondary"
            size="sm"
            label={t('common.retry')}
            onPress={run}
          />
        </InlineNotice>
      )}
      {phase === 'done' && (
        <>
          <Text style={[styles.heading, { color: ink }]}>{t('feed.remote.heading')}</Text>
          {rows.length === 0 ? (
            <Text testID="feed-remote-search-none" style={[styles.facts, { color: ink }]}>
              {t('feed.remote.none')}
            </Text>
          ) : (
            rows.map((row) => <RemoteRow key={row.id} row={row} isMetric={isMetric} />)
          )}
          {capped ? (
            <Text testID="feed-remote-search-capped" style={[styles.facts, { color: ink }]}>
              {t('feed.remote.capped')}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: CARD_MARGIN,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  heading: {
    ...typography.bodySmallBold,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  name: {
    ...typography.bodyBold,
  },
  facts: {
    ...typography.bodySmall,
  },
});
