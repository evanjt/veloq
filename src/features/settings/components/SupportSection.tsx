import React, { useCallback, useRef } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/shared/app';
import { INTERVALS_URLS } from '@/shared/app/constants';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ChromeIcon } from '@/shared/ui/ChromeIcon';
import { openExternal } from '@/shared/app/openExternal';
import { useDonation } from '@/shared/app/useDonation';
import { TipButtons } from '@/shared/ui/TipButtons';
import {
  GITHUB_ISSUES_URL,
  GITHUB_SPONSORS_URL,
  openForum,
  openStorePage,
  offerCrashLog,
} from '@/shared/app/supportLinks';
import { colors, darkColors, iconSize, layout, spacing, stroke, typography } from '@/theme';
import {
  Button,
  Card,
  ExternalLinkRow,
  ListSectionHeader,
  pressable,
  pressRipple,
} from '@/shared/ui';

export function SupportSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const { products, isAvailable, isPurchasing, purchaseSuccess, purchase } = useDonation();

  const crashLogAnchor = useRef<View>(null);
  const handleShareCrashLog = useCallback(() => offerCrashLog(t, crashLogAnchor), [t]);

  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const dividerColor = isDark ? darkColors.border : colors.divider;

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
              icon={<MaterialCommunityIcons name="star" size={iconSize.md} color={textColor} />}
            />
            <Button
              label={t('support.idea')}
              onPress={() => {
                void openExternal(`${GITHUB_ISSUES_URL}?labels=enhancement`);
              }}
              variant="secondary"
              size="sm"
              style={styles.actionButton}
              icon={
                <MaterialCommunityIcons
                  name="lightbulb-outline"
                  size={iconSize.md}
                  color={textColor}
                />
              }
            />
            <Button
              label={t('support.forum')}
              onPress={() => {
                void openForum();
              }}
              variant="secondary"
              size="sm"
              style={styles.actionButton}
              icon={
                <MaterialCommunityIcons name="forum-outline" size={iconSize.md} color={textColor} />
              }
            />
          </View>

          <View style={[styles.divider, { backgroundColor: dividerColor }]} />

          {/* Tips */}
          <View style={styles.row}>
            <MaterialCommunityIcons
              name="wrench-outline"
              size={iconSize.md}
              color={colors.primary}
            />
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
                icon={<MaterialCommunityIcons name="github" size={iconSize.md} color={textColor} />}
              />
            ))}

          <View style={[styles.divider, { backgroundColor: dividerColor }]} />

          {/* intervals.icu row */}
          {/* The card's own padding is the row's inset, so the row runs to its edges. */}
          <View style={styles.bleed}>
            <ExternalLinkRow url={INTERVALS_URLS.subscription} label={t('settings.subscribe')}>
              <MaterialCommunityIcons name="heart" size={iconSize.md} color={colors.chartPink} />
              <View style={styles.rowTextGroup}>
                <Text style={[styles.rowText, { color: textColor }]}>intervals.icu</Text>
                <Text style={[styles.rowSubtext, { color: mutedColor }]}>
                  {t('settings.subscribe')}
                </Text>
              </View>
            </ExternalLinkRow>
          </View>

          <View style={[styles.divider, { backgroundColor: dividerColor }]} />

          <Pressable
            ref={crashLogAnchor}
            accessibilityRole="button"
            accessibilityLabel={t('support.shareCrashLog')}
            testID="support-crash-log"
            onPress={handleShareCrashLog}
            style={pressable(styles.row)}
            android_ripple={pressRipple}
          >
            <MaterialCommunityIcons name="bug-outline" size={iconSize.md} color={mutedColor} />
            <Text style={[styles.rowText, { color: textColor }]}>{t('support.shareCrashLog')}</Text>
            <ChromeIcon name="share" size={iconSize.md} color={mutedColor} />
          </Pressable>
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
  divider: {
    height: stroke.hairline,
    marginVertical: spacing.sm,
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
