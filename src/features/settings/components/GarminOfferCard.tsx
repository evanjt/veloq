/**
 * The feed card that offers the Garmin connector after a download brought rides
 * intervals.icu holds back. What it offers is `garminOffer`'s to say, and whether
 * it shows is the session's one ask. Not now holds it until a later download
 * brings more such rides.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import { Button } from '@/shared/ui';
import { Card } from '@/shared/ui/Card';
import { colors, darkColors, spacing, typography } from '@/theme';

import { useGarminOffer } from '../hooks/useGarminOffer';

export function GarminOfferCard() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { offer, holdsAsk, decline } = useGarminOffer();

  if (!offer || !holdsAsk) return null;

  const palette = isDark ? darkColors : colors;

  return (
    <View testID="garmin-offer-card">
      <Card variant="raised" style={{ gap: spacing.xs }}>
        <Text style={[styles.title, { color: palette.textPrimary }]}>
          {t('garmin.offerTitle', { count: offer.count })}
        </Text>
        <Text style={[styles.description, { color: palette.textSecondary }]}>
          {t('garmin.offerBody')}
        </Text>
        <View style={styles.actions}>
          <Button
            testID="garmin-offer-dismiss"
            label={t('whatsNew.tourOfferDismiss')}
            variant="ghost"
            size="sm"
            onPress={decline}
          />
          <Button
            testID="garmin-offer-connect"
            label={t('garmin.offerConnect')}
            variant="primary"
            size="sm"
            onPress={() => navigateTo('/garmin-connector')}
          />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.bodyBold,
  },
  description: {
    ...typography.bodySmall,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
});
