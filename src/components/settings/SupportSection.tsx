import React, { useCallback, useRef } from 'react';
import { View, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import { Text, Switch } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as StoreReview from 'expo-store-review';
import Constants from 'expo-constants';
import { navigateTo } from '@/lib';
import { useDebugStore, useWhatsNewStore } from '@/providers';
import { useDonation } from '@/hooks/useDonation';
import { TipButtons } from '@/components/ui/TipButtons';
import { getAllSlides } from '@/components/ui/whatsNew/slides';
import { colors, darkColors, spacing, layout, shadows, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';

const FORUM_URL =
  'https://forum.intervals.icu/t/veloq-route-and-section-matching-mapping-app/120283';
const GITHUB_ISSUES_URL = 'https://github.com/evanjt/veloq/issues/new';
const GITHUB_SPONSORS_URL = 'https://github.com/sponsors/evanjt';

export function SupportSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const { products, isAvailable, isPurchasing, purchaseSuccess, purchase } = useDonation();

  const debugUnlocked = useDebugStore((s) => s.unlocked);
  const debugEnabled = useDebugStore((s) => s.enabled);
  const setDebugEnabled = useDebugStore((s) => s.setEnabled);
  const debugTapCount = useRef(0);
  const debugTapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleVersionTap = useCallback(() => {
    if (debugUnlocked) return;
    debugTapCount.current += 1;
    clearTimeout(debugTapTimer.current);
    if (debugTapCount.current >= 5) {
      debugTapCount.current = 0;
      useDebugStore.getState().unlock();
    } else {
      debugTapTimer.current = setTimeout(() => {
        debugTapCount.current = 0;
      }, 2000);
    }
  }, [debugUnlocked]);

  const handleReview = useCallback(async () => {
    if (await StoreReview.hasAction()) {
      await StoreReview.requestReview();
    } else {
      WebBrowser.openBrowserAsync('https://github.com/evanjt/veloq');
    }
  }, []);

  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const dividerColor = isDark ? darkColors.border : colors.divider;

  return (
    <>
      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('settings.support').toUpperCase()}
      </Text>

      <View style={[styles.card, isDark && styles.cardDark]}>
        {/* Action buttons */}
        <View style={styles.actionRow}>
          <Pressable
            onPress={handleReview}
            style={[styles.actionButton, isDark && styles.actionButtonDark]}
          >
            <MaterialCommunityIcons name="star" size={20} color={textColor} />
            <Text style={[styles.actionButtonText, { color: textColor }]}>
              {t('support.review')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => WebBrowser.openBrowserAsync(`${GITHUB_ISSUES_URL}?labels=enhancement`)}
            style={[styles.actionButton, isDark && styles.actionButtonDark]}
          >
            <MaterialCommunityIcons name="lightbulb-outline" size={20} color={textColor} />
            <Text style={[styles.actionButtonText, { color: textColor }]}>{t('support.idea')}</Text>
          </Pressable>
          <Pressable
            onPress={() => WebBrowser.openBrowserAsync(FORUM_URL)}
            style={[styles.actionButton, isDark && styles.actionButtonDark]}
          >
            <MaterialCommunityIcons name="forum-outline" size={20} color={textColor} />
            <Text style={[styles.actionButtonText, { color: textColor }]}>
              {t('support.forum')}
            </Text>
          </Pressable>
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
            <View style={styles.tipContent}>
              <TipButtons
                products={products}
                isPurchasing={isPurchasing}
                onTip={(id) => purchase(id)}
                isDark={isDark}
              />
            </View>
          ) : (
            <Pressable
              onPress={() => WebBrowser.openBrowserAsync(GITHUB_SPONSORS_URL)}
              style={[styles.sponsorButton, isDark && styles.sponsorButtonDark]}
            >
              <MaterialCommunityIcons name="github" size={18} color={textColor} />
              <Text style={[styles.sponsorText, { color: textColor }]}>
                {t('support.sponsorGitHub')}
              </Text>
            </Pressable>
          ))}

        <View style={[styles.divider, { backgroundColor: dividerColor }]} />

        {/* intervals.icu row */}
        <Pressable
          onPress={() => WebBrowser.openBrowserAsync('https://intervals.icu/settings/subscription')}
          style={styles.row}
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
      </View>

      {getAllSlides().length > 0 && (
        <TouchableOpacity
          style={styles.toggleRow}
          onPress={() => useWhatsNewStore.getState().startTour('tutorial')}
          activeOpacity={0.7}
        >
          <View style={styles.toggleInfo}>
            <Text style={[styles.toggleLabel, isDark && settingsStyles.textLight]}>
              {t('settings.appTour')}
            </Text>
            <Text style={[styles.toggleDescription, isDark && settingsStyles.textMuted]}>
              {t('settings.appTourDescription')}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color={mutedColor} />
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.toggleRow}
        onPress={() => navigateTo('/about')}
        activeOpacity={0.7}
      >
        <View style={styles.toggleInfo}>
          <Text style={[styles.toggleLabel, isDark && settingsStyles.textLight]}>
            {t('about.title')}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={24} color={mutedColor} />
      </TouchableOpacity>

      <Pressable onPress={handleVersionTap}>
        <Text
          testID="settings-version-text"
          style={[styles.versionText, isDark && settingsStyles.textMuted]}
        >
          {t('settings.version')} {Constants.expoConfig?.version ?? '0.0.1'}
        </Text>
      </Pressable>

      {(debugUnlocked || debugEnabled) && (
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={[styles.toggleLabel, isDark && settingsStyles.textLight]}>Debug Mode</Text>
            <Text style={[styles.toggleDescription, isDark && settingsStyles.textMuted]}>
              Show internal diagnostics in detail pages
            </Text>
          </View>
          <Switch value={debugEnabled} onValueChange={setDebugEnabled} color={colors.primary} />
        </View>
      )}
      {debugEnabled && (
        <TouchableOpacity
          style={styles.toggleRow}
          onPress={() => navigateTo('/debug')}
          activeOpacity={0.7}
        >
          <View style={styles.toggleInfo}>
            <Text style={[styles.toggleLabel, isDark && settingsStyles.textLight]}>
              Developer Dashboard
            </Text>
            <Text style={[styles.toggleDescription, isDark && settingsStyles.textMuted]}>
              Engine stats, FFI performance, memory
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color={mutedColor} />
        </TouchableOpacity>
      )}
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
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: layout.borderRadiusSm,
  },
  actionButtonDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  actionButtonText: {
    ...typography.caption,
    fontWeight: '500',
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
  sponsorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: layout.borderRadiusSm,
  },
  sponsorButtonDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  sponsorText: {
    ...typography.bodySmall,
    fontWeight: '600',
  },
  versionText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  toggleInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  toggleLabel: {
    ...typography.body,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  toggleDescription: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
