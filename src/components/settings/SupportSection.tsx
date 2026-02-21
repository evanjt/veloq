import React, { useCallback, useRef } from 'react';
import { View, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import { Text, Switch } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { router, type Href } from 'expo-router';
import { useDebugStore } from '@/providers';
import { colors, darkColors, spacing, layout } from '@/theme';

export function SupportSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();

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
      <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
        {t('settings.support').toUpperCase()}
      </Text>
      <View style={styles.supportRow}>
        <TouchableOpacity
          style={[styles.supportCard, isDark && styles.supportCardDark]}
          onPress={() => WebBrowser.openBrowserAsync('https://intervals.icu/settings/subscription')}
          activeOpacity={0.7}
        >
          <View style={[styles.supportIconBg, { backgroundColor: 'rgba(233, 30, 99, 0.12)' }]}>
            <MaterialCommunityIcons name="heart" size={24} color={colors.chartPink} />
          </View>
          <Text style={[styles.supportTitle, isDark && styles.textLight]}>intervals.icu</Text>
          <Text style={[styles.supportSubtitle, isDark && styles.textMuted]}>
            {t('settings.subscribe')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.supportCard, isDark && styles.supportCardDark]}
          onPress={() => WebBrowser.openBrowserAsync('https://github.com/sponsors/evanjt')}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.supportIconBg,
              {
                backgroundColor: isDark ? darkColors.surfaceElevated : colors.divider,
              },
            ]}
          >
            <MaterialCommunityIcons
              name="github"
              size={24}
              color={isDark ? colors.textOnDark : colors.textPrimary}
            />
          </View>
          <Text style={[styles.supportTitle, isDark && styles.textLight]}>@evanjt</Text>
          <Text style={[styles.supportSubtitle, isDark && styles.textMuted]}>
            {t('settings.sponsorDev')}
          </Text>
        </TouchableOpacity>
      </View>

      <Pressable onPress={handleVersionTap}>
        <Text
          testID="settings-version-text"
          style={[styles.versionText, isDark && styles.textMuted]}
        >
          {t('settings.version')} {Constants.expoConfig?.version ?? '0.0.1'}
        </Text>
      </Pressable>

      {(debugUnlocked || debugEnabled) && (
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={[styles.toggleLabel, isDark && styles.textLight]}>Debug Mode</Text>
            <Text style={[styles.toggleDescription, isDark && styles.textMuted]}>
              Show internal diagnostics in detail pages
            </Text>
          </View>
          <Switch value={debugEnabled} onValueChange={setDebugEnabled} color={colors.primary} />
        </View>
      )}
      {debugEnabled && (
        <TouchableOpacity
          style={styles.toggleRow}
          onPress={() => router.push('/debug' as Href)}
          activeOpacity={0.7}
        >
          <View style={styles.toggleInfo}>
            <Text style={[styles.toggleLabel, isDark && styles.textLight]}>
              Developer Dashboard
            </Text>
            <Text style={[styles.toggleDescription, isDark && styles.textMuted]}>
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
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: layout.screenPadding,
    letterSpacing: 0.5,
  },
  supportRow: {
    flexDirection: 'row',
    marginHorizontal: layout.screenPadding,
    gap: spacing.sm,
  },
  supportCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  supportCardDark: {
    backgroundColor: darkColors.surfaceCard,
    shadowOpacity: 0,
  },
  supportIconBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  supportTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  supportSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  versionText: {
    fontSize: 12,
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
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  toggleDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
