import React, { useEffect, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { spacing } from '@/theme';
import { batteryOptimisationExempt } from '@/features/recording/lib/recordingNotification';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { Button } from '@/shared/ui/Button';
import { InlineNotice } from '@/shared/ui/InlineNotice';

/**
 * One-time, dismissable Android nudge to exempt Veloq from battery
 * optimisation so long recordings are not killed in the background. Opens the
 * system battery-optimisation list (never the per-app dialog directly).
 * Shown only while Android reports the app is not exempt.
 */
export function BatteryOptimisationNudge() {
  const { t } = useTranslation();
  const dismissed = useRecordingPreferences((s) => s.batteryOptDismissed);
  const isLoaded = useRecordingPreferences((s) => s.isLoaded);
  const dismiss = useRecordingPreferences((s) => s.dismissBatteryOptNudge);
  const exempt = useBatteryOptimisationExempt();

  if (Platform.OS !== 'android' || dismissed || !isLoaded || exempt) return null;

  const openBatterySettings = () => {
    Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() => {
      Linking.openSettings();
    });
  };

  return (
    <InlineNotice
      testID="battery-opt-nudge"
      tone="warning"
      icon="battery-alert-variant-outline"
      title={t(
        'recording.batteryOptNudge',
        'Long recordings work best with battery optimisation off for Veloq.'
      )}
      onDismiss={dismiss}
      style={styles.container}
    >
      <Button
        onPress={openBatterySettings}
        label={t('recording.batteryOptOpenSettings', 'Open battery settings')}
        variant="ghost"
        size="sm"
      />
    </InlineNotice>
  );
}

/**
 * The exemption is granted and revoked in system settings, which the nudge
 * itself opens, so it is read again on every return to the app. A read raises
 * no dialog.
 */
function useBatteryOptimisationExempt(): boolean {
  const android = Platform.OS === 'android';
  const [exempt, setExempt] = useState(() => android && batteryOptimisationExempt() === true);

  useEffect(() => {
    if (!android) return undefined;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setExempt(batteryOptimisationExempt() === true);
    });
    return () => subscription.remove();
  }, [android]);

  return exempt;
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
});
