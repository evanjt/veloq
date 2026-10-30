/**
 * The feed card that says the sections were re-cut, and where the old ones are.
 *
 * It asks once a cutover has settled and stored its summary, or when a record
 * restore archived sections, and the athlete has not answered it. A cutover that
 * is running, or that failed, has no summary to give. A cut stored before
 * elevation was decided has no counts yet, so the card says the rebuild happened
 * and that older activities join as they download. The summary line is the
 * stored diff; See them opens the retired screen and shows only when sections
 * were retired and the counts are final. Not now is remembered across launches.
 * Whether it shows is the session's one ask.
 */
import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import {
  CUTOVER_FAILURE_KEYS,
  useArchivedRetiredCount,
  useCutoverSummary,
} from '@/features/routes';
import { useTheme } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import { Button } from '@/shared/ui';
import { Card } from '@/shared/ui/Card';
import { Icon } from '@/shared/ui/Icon';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';

import { describeCutoverCounts } from './whatsNew/SectionChangeCardSlide';
import { useSessionAsk } from '../hooks/useLaunchSurfaces';
import { useWhatsNewStore } from '../stores/WhatsNewStore';

export function SectionsChangedCard() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const total = useArchivedRetiredCount();
  const { isRunning, phase, counts, countsOwed } = useCutoverSummary();
  const failed = phase in CUTOVER_FAILURE_KEYS;
  const dismissed = useWhatsNewStore((s) => s.sectionsChangedDismissed);
  const dismiss = useWhatsNewStore((s) => s.dismissSectionsChanged);
  const eligible =
    (total > 0 || counts !== null || countsOwed) && !isRunning && !failed && !dismissed;
  const holdsAsk = useSessionAsk('sectionsChanged', eligible);

  const open = useCallback(() => {
    dismiss();
    navigateTo('/detection-preview?layer=retired');
  }, [dismiss]);

  if (!eligible || !holdsAsk) return null;

  return (
    <View testID="sections-changed-card">
      <Card variant="raised" style={{ gap: spacing.sm }}>
        <View style={styles.header}>
          <Icon
            name="archive-outline"
            size={iconSize.lg}
            color={isDark ? darkColors.textPrimary : colors.textPrimary}
          />
          <Text style={[styles.title, isDark && styles.titleDark]}>
            {t('feed.sectionsChangedTitle')}
          </Text>
        </View>
        <Text
          testID="sections-changed-body"
          style={[styles.description, isDark && styles.descriptionDark]}
        >
          {countsOwed
            ? t('feed.sectionsChangedBodyStaged')
            : total > 0
              ? t('feed.sectionsChangedBody', { total })
              : t('feed.sectionsChangedBodyNone')}
        </Text>
        {counts !== null && (
          <Text
            testID="sections-changed-counts"
            style={[styles.description, isDark && styles.descriptionDark]}
          >
            {describeCutoverCounts(
              counts,
              t as (key: string, vars?: Record<string, unknown>) => string
            )}
          </Text>
        )}
        <View style={styles.actions}>
          <Button
            testID="sections-changed-dismiss"
            label={t('feed.sectionsChangedDismiss')}
            variant="ghost"
            size="sm"
            onPress={dismiss}
          />
          {total > 0 && !countsOwed && (
            <Button
              testID="sections-changed-see"
              label={t('feed.sectionsChangedSee')}
              variant="primary"
              size="sm"
              onPress={open}
            />
          )}
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
