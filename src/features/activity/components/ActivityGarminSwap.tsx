import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { SwapState, type FitFile, type GarminMatch } from 'veloqrs';

import { useTheme } from '@/shared/app';
import { GrantAccessButton } from '@/features/recording';
import { ABSENT } from '@/shared/format';
import { formatDateTime, formatFileSize } from '@/shared/format/format';
import { formatDecimal } from '@/shared/format/number';
import { Badge, Button, DataTable, StatusLine, type DataTableRow } from '@/shared/ui';
import { useExperimental } from '@/features/settings/light';
import { colors, darkColors, spacing, typography } from '@/theme';

import { useAskGarminSwap } from '../hooks/useAskGarminSwap';
import { useGarminSwap } from '../hooks/useGarminSwap';

interface Props {
  activityId: string;
}

/**
 * The foot of an activity intervals.icu imported from Garmin: an experimental
 * feature, absent unless its experimental switch is on. A button
 * that replaces intervals.icu's copy with Garmin's own file, and Undo
 * once it has. The engine decides whether to show either, so nothing renders
 * without a connected key and a Garmin file that holds more than the copy.
 * A sign-in without write access asks for it at the tap, before the
 * confirmation, and the swap goes ahead only once it is granted.
 */
export function ActivityGarminSwap({ activityId }: Props) {
  const garminOn = useExperimental('garminUpdate');
  return garminOn ? <GarminSwapBody activityId={activityId} /> : null;
}

function GarminSwapBody({ activityId }: Props) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { state, match, busy, notice, check, swap, undo } = useGarminSwap(activityId);
  const { askToSwap, isUpgrading, upgradePermissions, upgradeError } = useAskGarminSwap(swap);
  const palette = isDark ? darkColors : colors;

  if (state === SwapState.Hidden && !notice) return null;

  const statusStyle = [typography.caption, { color: palette.textSecondary }];

  return (
    <View style={styles.container} testID={`activity-${activityId}-garmin-swap`}>
      {state === SwapState.Checkable ? (
        <>
          <View style={styles.titleRow}>
            <Button
              testID={`activity-${activityId}-garmin-check-button`}
              variant="secondary"
              label={t('activity.garminSwap.check')}
              onPress={check}
              loading={busy}
            />
            <Badge tone="neutral" size="sm" isDark={isDark} text={t('activity.garminSwap.badge')} />
          </View>
          <Text style={[styles.detail, { color: palette.textSecondary }]}>
            {t('activity.garminSwap.checkDetail')}
          </Text>
        </>
      ) : null}
      {state === SwapState.Unchanged ? (
        <Text
          testID={`activity-${activityId}-garmin-nothing-more`}
          style={[styles.detail, { color: palette.textSecondary }]}
        >
          {t('activity.garminSwap.nothingMore')}
        </Text>
      ) : null}
      {state === SwapState.Available ? (
        <>
          <View style={styles.titleRow}>
            <Button
              testID={`activity-${activityId}-garmin-swap-button`}
              variant="secondary"
              label={t('activity.garminSwap.button')}
              onPress={askToSwap}
              loading={busy || isUpgrading}
              opensConfirm
            />
            <Badge tone="neutral" size="sm" isDark={isDark} text={t('activity.garminSwap.badge')} />
          </View>
          <Text style={[styles.detail, { color: palette.textSecondary }]}>
            {t('activity.garminSwap.detail')}
          </Text>
        </>
      ) : null}
      {match ? (
        <GarminMatchPanel
          activityId={activityId}
          match={match}
          restores={state === SwapState.Undoable}
        />
      ) : null}
      {state === SwapState.Undoable ? (
        <Button
          testID={`activity-${activityId}-garmin-swap-undo`}
          variant="secondary"
          label={t('activity.garminSwap.undo')}
          onPress={undo}
          loading={busy}
        />
      ) : null}
      {upgradeError ? (
        <StatusLine
          message={upgradeError}
          tone="error"
          style={styles.status}
          textStyle={statusStyle}
          testID={`activity-${activityId}-garmin-swap-upgrade-error`}
        />
      ) : null}
      {notice ? (
        <StatusLine
          message={t(notice.key)}
          tone={notice.tone}
          style={styles.status}
          textStyle={statusStyle}
          testID={`activity-${activityId}-garmin-swap-status`}
        />
      ) : null}
      {notice?.key === 'activity.garminSwap.permission' ? (
        <View style={styles.status}>
          <GrantAccessButton
            testID={`activity-${activityId}-garmin-swap-grant-access`}
            onPress={() => void upgradePermissions()}
            loading={isUpgrading}
            small
          />
        </View>
      ) : null}
    </View>
  );
}

function startOf(file: FitFile): string {
  return file.startUnix === undefined ? ABSENT : formatDateTime(file.startUnix * 1000);
}

/** The match a check found and the two files it compared. */
function GarminMatchPanel({
  activityId,
  match,
  restores,
}: {
  activityId: string;
  match: GarminMatch;
  restores: boolean;
}) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const { garmin, intervals } = match;
  const rows: DataTableRow[] = [
    {
      key: 'size',
      cells: [
        t('activity.garminSwap.compare.size'),
        formatFileSize(garmin.sizeBytes),
        formatFileSize(intervals.sizeBytes),
      ],
    },
    {
      key: 'start',
      cells: [t('activity.garminSwap.compare.start'), startOf(garmin), startOf(intervals)],
    },
    {
      key: 'device',
      cells: [
        t('activity.garminSwap.compare.device'),
        garmin.device ?? ABSENT,
        intervals.device ?? ABSENT,
      ],
    },
    {
      key: 'records',
      cells: [
        t('activity.garminSwap.compare.records'),
        formatDecimal(garmin.recordCount, 0),
        formatDecimal(intervals.recordCount, 0),
      ],
    },
  ];
  return (
    <View style={styles.match} testID={`activity-${activityId}-garmin-match`}>
      <Text style={[typography.label, { color: palette.textPrimary }]}>
        {t('activity.garminSwap.matchFound')}
      </Text>
      <Text
        testID={`activity-${activityId}-garmin-match-id`}
        style={[typography.caption, { color: palette.textSecondary }]}
      >
        {t('activity.garminSwap.matchId', { id: match.garminId })}
      </Text>
      <DataTable
        columns={[
          t('activity.garminSwap.compare.detail'),
          t('activity.garminSwap.compare.garmin'),
          restores
            ? t('activity.garminSwap.compare.earlier')
            : t('activity.garminSwap.compare.intervals'),
        ]}
        rows={rows}
        rowTestIDPrefix={`activity-${activityId}-garmin-match-row-`}
        columnWeights={[1, 1.4, 1.4]}
      />
      <Text
        testID={`activity-${activityId}-garmin-match-fields`}
        style={[typography.caption, { color: palette.textSecondary }]}
      >
        {match.missingFields.length > 0
          ? t('activity.garminSwap.compare.missing', { fields: match.missingFields.join(', ') })
          : t('activity.garminSwap.compare.noneMissing')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  match: {
    alignSelf: 'stretch',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  container: {
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  detail: {
    ...typography.caption,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  status: {
    marginTop: spacing.sm,
  },
});
