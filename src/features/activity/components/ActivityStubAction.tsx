import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { StubVerdict, SwapState } from 'veloqrs';

import { useTheme } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import { Badge } from '@/shared/ui/Badge';
import { TextLink } from '@/shared/ui/TextLink';
import { useExperimental } from '@/features/settings/light';
import { colors, darkColors, spacing, typography } from '@/theme';

import { useAskGarminSwap } from '../hooks/useAskGarminSwap';
import { useGarminSwap } from '../hooks/useGarminSwap';

interface Props {
  activityId: string;
  verdict: StubVerdict;
}

/**
 * The one quiet line on the card of an activity intervals.icu holds but does
 * not serve. The engine's verdict chooses it: an update when a Garmin key can
 * fill the stub, a pointer to the connector when none is connected, plain text
 * when the stub is not from Garmin. A served activity carries nothing. An
 * experimental feature, absent unless its switch is on.
 */
export function ActivityStubAction({ activityId, verdict }: Props) {
  const on = useExperimental('garminUpdate');
  if (!on || verdict === StubVerdict.NotStub) return null;
  if (verdict === StubVerdict.GarminUpdatable) return <UpdateLine activityId={activityId} />;
  return <MutedLine activityId={activityId} linked={verdict === StubVerdict.NoKey} />;
}

function UpdateLine({ activityId }: { activityId: string }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { busy, notice, swap } = useGarminSwap(activityId, SwapState.Available);
  const { askToSwap, isUpgrading } = useAskGarminSwap(swap);
  const palette = isDark ? darkColors : colors;

  return (
    <View style={styles.row} testID={`activity-card-${activityId}-stub-update`}>
      <TextLink
        label={t('activity.stubCard.update')}
        size="caption"
        accessibilityRole="button"
        accessibilityState={{ busy: busy || isUpgrading }}
        onPress={askToSwap}
      />
      <Badge tone="neutral" size="sm" isDark={isDark} text={t('activity.garminSwap.badge')} />
      {notice ? (
        <Text style={[typography.caption, { color: palette.textSecondary }]}>{t(notice.key)}</Text>
      ) : null}
    </View>
  );
}

function MutedLine({ activityId, linked }: { activityId: string; linked: boolean }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;

  if (linked) {
    return (
      <View style={styles.row}>
        <TextLink
          testID={`activity-card-${activityId}-stub-connect`}
          label={t('activity.stubCard.noKey')}
          size="caption"
          onPress={() => navigateTo('/garmin-connector')}
        />
      </View>
    );
  }
  return (
    <View style={styles.row}>
      <Text
        testID={`activity-card-${activityId}-stub-other`}
        style={[typography.caption, { color: palette.textSecondary }]}
      >
        {t('activity.stubCard.otherSource')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.smPlus,
  },
});
