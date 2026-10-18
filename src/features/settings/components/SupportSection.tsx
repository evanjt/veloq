import React, { useCallback, useRef } from 'react';
import { View, StyleSheet, type ViewInstance } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/shared/app';
import { INTERVALS_URLS } from '@/shared/app/constants';
import { useTranslation } from 'react-i18next';
import { ChromeIcon } from '@/shared/ui/ChromeIcon';
import { openExternal } from '@/shared/app/openExternal';
import { useDonation } from '@/shared/app/useDonation';
import { TipButtons } from '@/shared/ui/TipButtons';
import { RowDivider } from '@/shared/ui/RowGroup';
import {
  GITHUB_ISSUES_URL,
  GITHUB_SPONSORS_URL,
  openForum,
  openStorePage,
  offerCrashLog,
} from '@/shared/app/supportLinks';
import { colors, darkColors, iconSize, layout, spacing, typography, themePalette } from '@/theme';
import { Button, Card, ExternalLinkRow, ListSectionHeader, PressTarget } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';

export function SupportSection() {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const { t } = useTranslation();
  const { products, isAvailable, isPurchasing, purchaseSuccess, purchase } = useDonation();

  const crashLogAnchor = useRef<ViewInstance>(null);
  const handleShareCrashLog = useCallback(() => offerCrashLog(t, crashLogAnchor), [t]);

  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <>
      <ListSectionHeader>{t('settings.support')}</ListSectionHeader>

      <View testID="support-section" style={styles.frame}>
        <Card variant="raised">
          {/* Action buttons */}
          <View style={styles.actionRow}>
            <Button
              label={t('support.review')}
              onPress={() => {
                void openStorePage({ review: true });
              }}
              variant="secondary"
              size="sm"
              style={styles.actionButton}
              icon="star"
            />
            <Button
              label={t('support.idea')}
              onPress={() => {
                void openExternal(`${GITHUB_ISSUES_URL}?labels=enhancement`);
              }}
              variant="secondary"
              size="sm"
              style={styles.actionButton}
              icon="lightbulb-outline"
            />
            <Button
              label={t('support.forum')}
              onPress={() => {
                void openForum();
              }}
              variant="secondary"
              size="sm"
              style={styles.actionButton}
              icon="forum-outline"
            />
          </View>

          <View style={styles.dividerGap}>
            <RowDivider inset="none" />
          </View>

          {/* Tips */}
          <View style={styles.row}>
            <Icon name="wrench-outline" size={iconSize.md} color={palette.actionPrimary} />
            <Text style={[styles.rowText, { color: textColor }]}>
              {purchaseSuccess ? t('support.thankYou') : t('support.tipTitle')}
            </Text>
          </View>
          {!purchaseSuccess &&
            (isAvailable ? (
              <View testID="support-tip-buttons" style={styles.tipContent}>
                <TipButtons
                  products={products}
                  isPurchasing={isPurchasing}
                  onTip={(id) => purchase(id)}
                />
              </View>
            ) : (
              <Button
                testID="support-sponsor-button"
                label={t('support.sponsorGitHub')}
                onPress={() => {
                  void openExternal(GITHUB_SPONSORS_URL);
                }}
                variant="secondary"
                size="sm"
                icon="github"
              />
            ))}

          <View style={styles.dividerGap}>
            <RowDivider inset="none" />
          </View>

          {/* intervals.icu row */}
          {/* The card's own padding is the row's inset, so the row runs to its edges. */}
          <View style={styles.bleed}>
            <ExternalLinkRow url={INTERVALS_URLS.subscription} label={t('settings.subscribe')}>
              <Icon name="heart" size={iconSize.md} color={colors.chartPink} />
              <View style={styles.rowTextGroup}>
                <Text style={[styles.rowText, { color: textColor }]}>intervals.icu</Text>
                <Text style={[styles.rowSubtext, { color: mutedColor }]}>
                  {t('settings.subscribe')}
                </Text>
              </View>
            </ExternalLinkRow>
          </View>

          <View style={styles.dividerGap}>
            <RowDivider inset="none" />
          </View>

          <PressTarget
            ref={crashLogAnchor}
            accessibilityRole="button"
            accessibilityLabel={t('support.shareCrashLog')}
            testID="support-crash-log"
            onPress={handleShareCrashLog}
            style={styles.row}
          >
            <Icon name="bug-outline" size={iconSize.md} color={mutedColor} />
            <Text style={[styles.rowText, { color: textColor }]}>{t('support.shareCrashLog')}</Text>
            <ChromeIcon name="share" size={iconSize.md} color={mutedColor} />
          </PressTarget>
        </Card>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  frame: {
    marginHorizontal: layout.screenPadding,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actionButton: {
    flexGrow: 1,
  },
  dividerGap: {
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: layout.minTapTarget,
  },
  rowText: {
    ...typography.bodySmallBold,
    flex: 1,
  },
  rowTextGroup: {
    flex: 1,
  },
  bleed: {
    marginHorizontal: -spacing.md,
  },
  rowSubtext: {
    ...typography.caption,
  },
  tipContent: {
    paddingBottom: spacing.xs,
  },
});
