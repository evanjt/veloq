import React, { useCallback } from 'react';
import { Alert, Linking, Platform, View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useDonation } from '@/shared/app/useDonation';
import { TipButtons } from '@/shared/ui/TipButtons';
import { getCrashLog, formatCrashLog } from '@/shared/debug/crashLog';
import { shareFile } from '@/features/settings/lib/shareFile';
import { colors, darkColors, spacing, layout, shadows, typography } from '@/theme';
import { Button, ListSectionHeader, pressable, pressRipple } from '@/shared/ui';

const FORUM_URL =
  'https://forum.intervals.icu/t/veloq-route-and-section-matching-mapping-app/120283';
const GITHUB_ISSUES_URL = 'https://github.com/evanjt/veloq/issues/new';
const GITHUB_SPONSORS_URL = 'https://github.com/sponsors/evanjt';

export function SupportSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const { products, isAvailable, isPurchasing, purchaseSuccess, purchase } = useDonation();

  const handleReview = useCallback(async () => {
    if (Platform.OS === 'android') {
      Linking.openURL('market://details?id=com.veloq.app');
    } else if (Platform.OS === 'ios') {
      Linking.openURL('itms-apps://apps.apple.com/app/id6757836732?action=write-review');
    } else {
      WebBrowser.openBrowserAsync('https://github.com/evanjt/veloq');
    }
  }, []);

  const handleShareCrashLog = useCallback(async () => {
    const entries = await getCrashLog();
    if (!entries.length) {
      Alert.alert(t('support.shareCrashLog'), t('support.noCrashLog'));
      return;
    }
    await shareFile({
      content: formatCrashLog(entries),
      filename: 'veloq-crash-log.txt',
      mimeType: 'text/plain',
    });
  }, [t]);

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
            onPress={handleReview}
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
            onPress={() => WebBrowser.openBrowserAsync(FORUM_URL)}
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.subscribe')}
          onPress={() => WebBrowser.openBrowserAsync('https://intervals.icu/settings/subscription')}
          style={pressable(styles.row)}
          android_ripple={pressRipple}
        >
          <MaterialCommunityIcons name="heart" size={20} color={colors.chartPink} />
          <View style={styles.rowTextGroup}>
            <Text style={[styles.rowText, { color: textColor }]}>intervals.icu</Text>
            <Text style={[styles.rowSubtext, { color: mutedColor }]}>
              {t('settings.subscribe')}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={mutedColor} />
        </Pressable>

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
  },
  rowText: {
    ...typography.bodySmall,
    fontWeight: '500',
    flex: 1,
  },
  rowTextGroup: {
    flex: 1,
  },
  rowSubtext: {
    ...typography.caption,
  },
  tipContent: {
    paddingBottom: spacing.xs,
  },
});
