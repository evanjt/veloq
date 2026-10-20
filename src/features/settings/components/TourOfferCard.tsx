/**
 * The feed card that offers the tour, which never opens on its own.
 *
 * It offers the whole tour until the tour is taken or declined twice, less the
 * notification slide inside the quiet period, and afterwards, once, the setup
 * slides a tour closed without answering. What it
 * offers is `tourOffer`'s to say, and whether it shows is the session's one ask.
 */
import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';

import { Button } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { Card } from '@/shared/ui/Card';
import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { sourceFor } from '@/shared/app/source';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';

import { getTutorialSetupSlides } from './whatsNew/slides';
import { useQuietPeriod, useSessionAsk } from '../hooks/useLaunchSurfaces';
import { setupSlidesAnswerable, tourOffer } from '../lib/tourOffer';
import { useWhatsNewStore } from '../stores/WhatsNewStore';

export function TourOfferCard() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const authMethod = useAuthStore((s) => s.authMethod);
  const isLoaded = useWhatsNewStore((s) => s.isLoaded);
  const lastSeenVersion = useWhatsNewStore((s) => s.lastSeenVersion);
  const record = useWhatsNewStore((s) => s.tourOffer);
  const settledThisSession = useWhatsNewStore((s) => s.tourOfferSettled);
  const takeTourOffer = useWhatsNewStore((s) => s.takeTourOffer);
  const declineTourOffer = useWhatsNewStore((s) => s.declineTourOffer);
  const quiet = useQuietPeriod();
  const currentVersion = Constants.expoConfig?.version ?? '';

  const offer = isLoaded
    ? tourOffer({
        // Demo is not a sign-in: taking the tour there would mark it seen before the first real one.
        tourEligible: isAuthenticated && !isDemoMode,
        lastSeenVersion,
        record,
        settledThisSession,
        tourSetupSlides: setupSlidesAnswerable(getTutorialSetupSlides(), {
          push: sourceFor({ authMethod, isDemoMode })?.can.push === true,
        }),
        quietPeriod: quiet !== false,
      })
    : null;
  const holdsAsk = useSessionAsk('tourOffer', offer !== null);
  const only = offer?.kind === 'leftover' ? offer.slides : undefined;
  const held = offer?.kind === 'tour' ? offer.held : undefined;

  const open = useCallback(() => takeTourOffer(only, held), [takeTourOffer, only, held]);
  const dismiss = useCallback(
    () => declineTourOffer(currentVersion),
    [declineTourOffer, currentVersion]
  );

  if (!offer || !holdsAsk) return null;

  const leftover = offer.kind === 'leftover';
  const title = leftover
    ? t(
        offer.slides.length === 1
          ? 'whatsNew.setupLeftoverTitleOne'
          : 'whatsNew.setupLeftoverTitleTwo'
      )
    : t('whatsNew.tourOfferTitle');

  return (
    <View testID="tour-offer-card">
      <Card variant="raised" style={{ gap: spacing.sm }}>
        <View style={styles.header}>
          <Icon
            name={leftover ? 'cog-outline' : 'compass-outline'}
            size={iconSize.lg}
            color={isDark ? darkColors.textPrimary : colors.textPrimary}
          />
          <Text style={[styles.title, isDark && styles.titleDark]}>{title}</Text>
        </View>
        <Text style={[styles.description, isDark && styles.descriptionDark]}>
          {t(leftover ? 'whatsNew.setupLeftoverBody' : 'whatsNew.tourOfferBody')}
        </Text>
        <View style={styles.actions}>
          <Button
            testID="tour-offer-dismiss"
            label={t('whatsNew.tourOfferDismiss')}
            variant="ghost"
            size="sm"
            onPress={dismiss}
          />
          <Button
            testID="tour-offer-open"
            label={t(leftover ? 'whatsNew.setupLeftoverOpen' : 'whatsNew.tourOfferOpen')}
            variant="primary"
            size="sm"
            onPress={open}
          />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  description: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  descriptionDark: {
    color: darkColors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
});
