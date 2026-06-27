import React, { useCallback, useRef } from 'react';
import { View, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import { Text, Switch } from 'react-native-paper';
import { useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { navigateTo } from '@/shared/app/navigation';
import { useDebugStore } from '@/features/settings/stores/DebugStore';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { getAllSlides } from '@/features/settings/components/whatsNew/slides';
import { colors, darkColors, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';

export function FooterSection() {
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

  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <>
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
          <Switch
            testID="settings-debug-switch"
            value={debugEnabled}
            onValueChange={setDebugEnabled}
            color={colors.primary}
          />
        </View>
      )}
      {debugEnabled && (
        <TouchableOpacity
          testID="settings-developer-dashboard-link"
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
  versionText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
});
