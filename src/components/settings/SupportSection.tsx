import React, { useCallback, useRef } from 'react';
import { View, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import { Text, Switch } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { navigateTo } from '@/lib';
import { useDebugStore, useWhatsNewStore } from '@/providers';
import { useDonation } from '@/hooks/useDonation';
import { TipButtons } from '@/components/ui/TipButtons';
import { getAllSlides } from '@/components/ui/whatsNew/slides';
import { colors, darkColors, spacing, layout, shadows, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';

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

  return (
    <>
      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('settings.support').toUpperCase()}
      </Text>
      <View style={[styles.supportCard, isDark && styles.supportCardDark]}>
        <View style={styles.supportCardHeader}>
          <View style={[styles.supportIconBg, { backgroundColor: 'rgba(252, 76, 2, 0.12)' }]}>
            <MaterialCommunityIcons
              name={purchaseSuccess ? 'heart' : 'heart-outline'}
              size={22}
              color={colors.primary}
            />
          </View>
          <Text style={[styles.supportTitle, isDark && settingsStyles.textLight]}>
            {purchaseSuccess ? t('support.thankYou') : t('support.tipTitle')}
          </Text>
        </View>
        {purchaseSuccess ? (
          <Text style={[styles.thankYouText, isDark && settingsStyles.textMuted]}>
            {t('support.tipDescription')}
          </Text>
        ) : isAvailable && products.length > 0 ? (
          <TipButtons
            products={products}
            isPurchasing={isPurchasing}
            onTip={(id) => purchase(id)}
            isDark={isDark}
          />
        ) : (
          <TouchableOpacity
            onPress={() => WebBrowser.openBrowserAsync(GITHUB_SPONSORS_URL)}
            style={[styles.sponsorButton, isDark && styles.sponsorButtonDark]}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="github"
              size={18}
              color={isDark ? darkColors.textPrimary : colors.textPrimary}
            />
            <Text style={[styles.sponsorText, isDark && settingsStyles.textLight]}>
              {t('support.sponsorGitHub')}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        style={[styles.subscribeCard, isDark && styles.subscribeCardDark]}
        onPress={() => WebBrowser.openBrowserAsync('https://intervals.icu/settings/subscription')}
        activeOpacity={0.7}
      >
        <View style={[styles.supportIconBg, { backgroundColor: 'rgba(233, 30, 99, 0.12)' }]}>
          <MaterialCommunityIcons name="heart" size={22} color={colors.chartPink} />
        </View>
        <View style={styles.subscribeInfo}>
          <Text style={[styles.supportTitle, isDark && settingsStyles.textLight]}>
            intervals.icu
          </Text>
          <Text style={[styles.supportSubtitle, isDark && settingsStyles.textMuted]}>
            {t('settings.subscribe')}
          </Text>
        </View>
        <MaterialCommunityIcons
          name="chevron-right"
          size={24}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
      </TouchableOpacity>

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
          <MaterialCommunityIcons
            name="chevron-right"
            size={24}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
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
        <MaterialCommunityIcons
          name="chevron-right"
          size={24}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
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
          <MaterialCommunityIcons
            name="chevron-right"
            size={24}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </TouchableOpacity>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  supportCard: {
    marginHorizontal: layout.screenPadding,
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  supportCardDark: {
    backgroundColor: darkColors.surfaceCard,
    ...shadows.none,
  },
  supportCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  subscribeCard: {
    marginHorizontal: layout.screenPadding,
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  subscribeCardDark: {
    backgroundColor: darkColors.surfaceCard,
    ...shadows.none,
  },
  subscribeInfo: {
    flex: 1,
  },
  supportIconBg: {
    width: 40,
    height: 40,
    borderRadius: layout.borderRadiusLg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  supportTitle: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  supportSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
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
    color: colors.textPrimary,
  },
  thankYouText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
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
