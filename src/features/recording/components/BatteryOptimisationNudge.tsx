import React from 'react';
import { View, StyleSheet, TouchableOpacity, Platform, Linking } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { colors, colorWithOpacity, spacing, layout } from '@/theme';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';

/**
 * One-time, dismissable Android nudge to exempt Veloq from battery
 * optimisation so long recordings are not killed in the background. Opens the
 * system battery-optimisation list (never the per-app dialog directly).
 */
export function BatteryOptimisationNudge() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const dismissed = useRecordingPreferences((s) => s.batteryOptDismissed);
  const isLoaded = useRecordingPreferences((s) => s.isLoaded);
  const dismiss = useRecordingPreferences((s) => s.dismissBatteryOptNudge);

  if (Platform.OS !== 'android' || dismissed || !isLoaded) return null;

  const openBatterySettings = () => {
    Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() => {
      Linking.openSettings();
    });
  };

  return (
    <View
      testID="battery-opt-nudge"
      style={[
        styles.container,
        { backgroundColor: colorWithOpacity(colors.warning, isDark ? 0.18 : 0.1) },
      ]}
    >
      <MaterialCommunityIcons
        name="battery-alert-variant-outline"
        size={20}
        color={colors.warning}
      />
      <View style={styles.body}>
        <Text style={[styles.text, { color: colors.amberIcon }]}>
          {t(
            'recording.batteryOptNudge',
            'Long recordings work best with battery optimisation off for Veloq.'
          )}
        </Text>
        <TouchableOpacity onPress={openBatterySettings} accessibilityRole="button">
          <Text style={[styles.link, { color: colors.warning }]}>
            {t('recording.batteryOptOpenSettings', 'Open battery settings')}
          </Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        testID="battery-opt-nudge-dismiss"
        onPress={dismiss}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={t('common.close', 'Close')}
      >
        <MaterialCommunityIcons name="close" size={18} color={colors.amberIcon} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadiusSm,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  text: {
    fontSize: 13,
    lineHeight: 18,
  },
  link: {
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
