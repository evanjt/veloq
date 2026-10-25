/**
 * The tour's Garmin slide: what the connector brings, and the one place the tour
 * opens it. It is answerable only for an athlete whose intervals.icu uses Garmin.
 * Connect Garmin opens the connector and records the slide as answered, and Never
 * remind me again records the answer alone.
 */

import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import { Button } from '@/shared/ui';
import { colors, darkColors, spacing, typography } from '@/theme';

import { useUsesGarmin } from '../../hooks/useGarminOffer';
import { useWhatsNewStore } from '../../stores/WhatsNewStore';

export function GarminSlide() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const usesGarmin = useUsesGarmin();
  const answerSetup = useWhatsNewStore((s) => s.answerSetup);

  const connect = useCallback(() => {
    answerSetup('garmin', 'on');
    navigateTo('/garmin-connector');
  }, [answerSetup]);
  const never = useCallback(() => answerSetup('garmin', 'never'), [answerSetup]);

  return (
    <View style={styles.container}>
      <Text style={[styles.status, { color: palette.textSecondary }]}>
        {t('whatsNew.tutorial.garminWhy')}
      </Text>
      {usesGarmin ? (
        <View style={styles.actions}>
          <Button
            testID="tour-garmin-never"
            label={t('whatsNew.tutorial.neverRemind')}
            variant="ghost"
            size="sm"
            onPress={never}
          />
          <Button
            testID="tour-garmin-connect"
            label={t('garmin.offerConnect')}
            variant="primary"
            size="sm"
            onPress={connect}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'stretch',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  status: {
    ...typography.bodySmall,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
  },
});
