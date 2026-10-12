import React, { useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useDonation } from '@/shared/app/useDonation';
import { TipButtons } from '@/shared/ui/TipButtons';
import {
  GITHUB_ISSUES_URL,
  GITHUB_SPONSORS_URL,
  openForum,
  openStorePage,
  shareCrashLog,
} from '@/shared/app/supportLinks';
import { colors, darkColors, spacing, layout, shadows, typography } from '@/theme';
import { Button, ListSectionHeader, Row, pressable, pressRipple } from '@/shared/ui';

export function SupportSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const { products, isAvailable, isPurchasing, purchaseSuccess, purchase } = useDonation();

  const handleShareCrashLog = useCallback(() => shareCrashLog(t), [t]);

  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const dividerColor = isDark ? darkColors.border : colors.divider;

  return (
    <>
      <ListSectionHeader>{t('settings.support')}</ListSectionHeader>

      <View testID="support-section" style={[styles.card, isDark && styles.cardDark]}>
        {/* Action buttons */}
        <View style={styles.actionRow}>
          <Button
            label={t('support.review')}
            onPress={() => openStorePage({ review: true })}
            variant="secondary"
            size="sm"
            style={styles.actionButton}
            icon={<MaterialCommunityIcons name="star" size={20} color={textColor} />}
          />
          <Button
            label={t('support.idea')}
            onPress={() => WebBrowser.openBrowserAsync(`${GITHUB_ISSUES_URL}?labels=enhancement`)}
            variant="secondary"
            size="sm"
            style={styles.actionButton}
            icon={<MaterialCommunityIcons name="lightbulb-outline" size={20} color={textColor} />}
          />
          <Button
            label={t('support.forum')}
            onPress={openForum}
            variant="secondary"
            size="sm"
            style={styles.actionButton}
            icon={<MaterialCommunityIcons name="forum-outline" size={20} color={textColor} />}
          />
        </View>

        <View style={[styles.divider, { backgroundColor: dividerColor }]} />

        {/* Tips */}
        <View style={styles.row}>
          <MaterialCommunityIcons name="wrench-outline" size={20} color={colors.primary} />
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
                isDark={isDark}
              />
            </View>
          ) : (
            <Button
              testID="support-sponsor-button"
              label={t('support.sponsorGitHub')}
              onPress={() => WebBrowser.openBrowserAsync(GITHUB_SPONSORS_URL)}
              variant="secondary"
              size="sm"
              icon={<MaterialCommunityIcons name="github" size={18} color={textColor} />}
            />
          ))}

        <View style={[styles.divider, { backgroundColor: dividerColor }]} />

        {/* intervals.icu row */}
        {/* The card's own padding is the row's inset, so the row runs to its edges. */}
        <View style={styles.bleed}>
          <Row
            behaviour="navigate"
            accessibilityLabel={t('settings.subscribe')}
            onPress={() =>
              WebBrowser.openBrowserAsync('https://intervals.icu/settings/subscription')
            }
          >
            <MaterialCommunityIcons name="heart" size={20} color={colors.chartPink} />
            <View style={styles.rowTextGroup}>
              <Text style={[styles.rowText, { color: textColor }]}>intervals.icu</Text>
              <Text style={[styles.rowSubtext, { color: mutedColor }]}>
                {t('settings.subscribe')}
              </Text>
            </View>
          </Row>
        </View>

        <View style={[styles.divider, { backgroundColor: dividerColor }]} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('support.shareCrashLog')}
          testID="support-crash-log"
          onPress={handleShareCrashLog}
          style={pressable(styles.row)}
          android_ripple={pressRipple}
        >
          <MaterialCommunityIcons name="bug-outline" size={20} color={mutedColor} />
          <Text style={[styles.rowText, { color: textColor }]}>{t('support.shareCrashLog')}</Text>
          <MaterialCommunityIcons name="share-variant" size={18} color={mutedColor} />
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: layout.screenPadding,
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    ...shadows.card,
  },
  cardDark: {
    backgroundColor: darkColors.surfaceCard,
    ...shadows.none,
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
    height: StyleSheet.hairlineWidth,
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
    ...typography.bodySmall,
    fontWeight: '500',
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
