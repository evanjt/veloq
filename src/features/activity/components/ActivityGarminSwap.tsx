import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { SwapState } from 'veloqrs';

import { useTheme } from '@/shared/app';
import {
  GrantAccessButton,
  usePermissionUpgrade,
  useWriteAccessMissing,
} from '@/features/recording';
import { Badge, Button, StatusLine } from '@/shared/ui';
import { confirmAction } from '@/shared/ui/dialog';
import { useExperimental } from '@/features/settings/light';
import { colors, darkColors, spacing, typography } from '@/theme';

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
  const { state, busy, notice, swap, undo } = useGarminSwap(activityId);
  const writeAccessMissing = useWriteAccessMissing();
  const { upgradePermissions, isUpgrading, error: upgradeError } = usePermissionUpgrade();
  const palette = isDark ? darkColors : colors;

  if (state === SwapState.Hidden && !notice) return null;

  const confirmSwap = () =>
    confirmAction({
      title: t('activity.garminSwap.confirmTitle'),
      message: t('activity.garminSwap.confirmMessage'),
      confirmLabel: t('activity.garminSwap.button'),
      cancelLabel: t('common.cancel'),
      onConfirm: swap,
    });

  const askToSwap = async () => {
    if (writeAccessMissing) {
      const { granted } = await upgradePermissions();
      if (!granted) return;
    }
    confirmSwap();
  };

  const statusStyle = [typography.caption, { color: palette.textSecondary }];

  return (
    <View style={styles.container} testID={`activity-${activityId}-garmin-swap`}>
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

const styles = StyleSheet.create({
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
