/**
 * The Garmin pull's progress, beside the stream download row: how many rides
 * are stored, the month the history has reached, and whether the pass is
 * running, paused until a time, done or stopped. A paused or stopped pass
 * offers Pull now. The row stays away until a Garmin key is held, and while
 * Garmin's experimental switch is off.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { colors, darkColors, spacing, typography } from '@/theme';

import { formatPullMonth, garminPullLine, offersPullNow } from '../lib/garminPullLine';
import { useGarminPull } from '../hooks/useGarminPull';
import { Button, Row } from '@/shared/ui';
import { ExperimentalOnly } from './ExperimentalOnly';

interface GarminPullRowProps {
  isDark: boolean;
}

export function GarminPullRow({ isDark }: GarminPullRowProps) {
  return (
    <ExperimentalOnly feature="garminUpdate">
      <GarminPullRowBody isDark={isDark} />
    </ExperimentalOnly>
  );
}

function GarminPullRowBody({ isDark }: GarminPullRowProps) {
  const { t, i18n } = useTranslation();
  const { pull, pullNow } = useGarminPull();
  if (!pull) return null;

  const line = garminPullLine(pull, i18n.language);
  const detail = [
    t('garmin.pullStored', { count: pull.stored }),
    pull.reachedMonth
      ? t('garmin.pullReached', { month: formatPullMonth(pull.reachedMonth, i18n.language) })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Row testID="settings-garmin-pull">
      <View style={styles.block}>
        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, isDark && styles.textSecondary]}>
            {t('garmin.pullTitle')}
          </Text>
          <View style={styles.infoValueRow}>
            <Text
              testID="settings-garmin-pull-status"
              style={[styles.infoValue, isDark && styles.textLight]}
            >
              {t(line.key, { time: line.time })}
            </Text>
            {offersPullNow(pull) ? (
              <Button
                testID="settings-garmin-pull-now"
                label={t('garmin.pullNow')}
                onPress={pullNow}
                variant="ghost"
                size="sm"
              />
            ) : null}
          </View>
        </View>
        <Text
          testID="settings-garmin-pull-detail"
          style={[styles.detail, isDark && styles.textSecondary]}
        >
          {detail}
        </Text>
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  block: {
    flex: 1,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detail: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  infoLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  infoValue: {
    ...typography.bodySmallBold,
    color: colors.textPrimary,
  },
  infoValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  textLight: {
    color: colors.textOnFill,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
});
