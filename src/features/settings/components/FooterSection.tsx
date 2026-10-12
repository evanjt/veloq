import React, { useCallback, useRef } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { tapTo } from '@/shared/app/navigation';
import { useDebugStore } from '@/features/settings/stores/DebugStore';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { colors, darkColors, spacing, typography } from '@/theme';
import { buildCommit, formatVersionLine } from '@/shared/format/buildStamp';
import { settingsStyles } from './settingsStyles';
import { Row, pressable, pressRipple, SwitchRow } from '@/shared/ui';

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

  const versionLine = formatVersionLine(Constants.expoConfig?.version ?? '0.0.1', buildCommit());

  return (
    <>
      <Row
        behaviour="navigate"
        accessibilityLabel={t('settings.appTour')}
        onPress={() => useWhatsNewStore.getState().startTour('tutorial')}
      >
        <View style={styles.toggleInfo}>
          <Text style={[styles.toggleLabel, isDark && settingsStyles.textLight]}>
            {t('settings.appTour')}
          </Text>
          <Text style={[styles.toggleDescription, isDark && styles.toggleDescriptionDark]}>
            {t('settings.appTourDescription')}
          </Text>
        </View>
      </Row>

      <Row
        behaviour="navigate"
        accessibilityLabel={t('about.title')}
        onPress={() => tapTo('/about')}
      >
        <View style={styles.toggleInfo}>
          <Text style={[styles.toggleLabel, isDark && settingsStyles.textLight]}>
            {t('about.title')}
          </Text>
        </View>
      </Row>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('settings.version')} ${versionLine}`}
        onPress={handleVersionTap}
        style={pressable()}
        android_ripple={pressRipple}
      >
        <Text
          testID="settings-version-text"
          style={[styles.versionText, isDark && styles.versionTextDark]}
        >
          {t('settings.version')} {versionLine}
        </Text>
      </Pressable>

      {(debugUnlocked || debugEnabled) && (
        <SwitchRow
          title={t('settings.debugMode')}
          description={t('settings.debugModeDescription')}
          value={debugEnabled}
          onValueChange={setDebugEnabled}
          testID="settings-debug-switch"
        />
      )}
      {debugEnabled && (
        <Row
          testID="settings-developer-dashboard-link"
          behaviour="navigate"
          accessibilityLabel={t('settings.developerDashboard')}
          onPress={() => tapTo('/debug')}
        >
          <View style={styles.toggleInfo}>
            <Text style={[styles.toggleLabel, isDark && settingsStyles.textLight]}>
              {t('settings.developerDashboard')}
            </Text>
            <Text style={[styles.toggleDescription, isDark && styles.toggleDescriptionDark]}>
              {t('settings.developerDashboardDescription')}
            </Text>
          </View>
        </Row>
      )}
    </>
  );
}

const styles = StyleSheet.create({
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
    marginTop: spacing.xxs,
  },
  toggleDescriptionDark: {
    color: darkColors.textSecondary,
  },
  versionText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  versionTextDark: {
    color: darkColors.textSecondary,
  },
});
