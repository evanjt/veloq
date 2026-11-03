import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, ScreenSafeAreaView, ScreenScrollView } from '@/shared/ui';
import { useTranslation } from 'react-i18next';
import { useTheme, useMetricSystem } from '@/shared/app';
import { colors, darkColors, spacing } from '@/theme';
import { navigateTo } from '@/shared/app/navigation';
import { fieldsForMode, MAX_DATA_FIELDS, useRecordingPreferences } from '@/features/recording';
import { useSensorStore } from '@/features/sensors';
import { SettingsNavRow } from '@/features/settings';
import { SCREEN_HEADERS, headerTitleOf } from '@/shared/app/screenHeaders';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { formatDecimal } from '@/shared/format';

function RecordingSettingsScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const bg = isDark ? darkColors.surfacePage : colors.surfacePage;

  const pairedSensorCount = useSensorStore((s) => s.knownSensors.length);
  const dataFields = useRecordingPreferences((s) => s.dataFields);
  const gpsAccuracyMode = useRecordingPreferences((s) => s.gpsAccuracyMode);
  const keepAwakeEnabled = useRecordingPreferences((s) => s.keepAwakeEnabled);
  const autoPauseEnabled = useRecordingPreferences((s) => s.autoPauseEnabled);
  const autoPauseDurationMs = useRecordingPreferences((s) => s.autoPauseDurationMs);
  const autoUploadEnabled = useRecordingPreferences((s) => s.autoUploadEnabled);

  const on = t('common.on');
  const off = t('common.off');

  const sensorsSummary =
    pairedSensorCount > 0
      ? t('sensors.pairedCount', { count: pairedSensorCount })
      : t('sensors.nonePairedShort');
  const fieldsSummary = t('recording.fieldsSelected', {
    selected: fieldsForMode(dataFields, 'gps').length,
    max: MAX_DATA_FIELDS,
  });
  const gpsSummary = `${t(`recording.gpsModes.${gpsAccuracyMode}`)}, ${t('recording.keepAwake')} ${
    keepAwakeEnabled ? on : off
  }`;
  const autoPauseSummary = autoPauseEnabled
    ? `${on}, ${formatDecimal(autoPauseDurationMs / 1000, 1)} ${t('units.seconds')}`
    : off;
  const uploadSummary = `${t('recording.autoUpload')} ${autoUploadEnabled ? on : off}`;

  const titleOf = (route: string) => headerTitleOf(SCREEN_HEADERS[route], t);

  return (
    <ScreenSafeAreaView
      testID="recording-settings-screen"
      style={[styles.container, { backgroundColor: bg }]}
    >
      <ScreenScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <Card variant="flat" padding="none">
            <SettingsNavRow
              testID="settings-sensors-link"
              icon="bluetooth"
              title={titleOf('sensor-settings')}
              subtitle={sensorsSummary}
              onPress={() => navigateTo('/sensor-settings')}
            />
            <SettingsNavRow
              testID="settings-data-fields-link"
              icon="view-grid-outline"
              title={titleOf('recording-data-fields')}
              subtitle={fieldsSummary}
              onPress={() => navigateTo('/recording-data-fields')}
            />
            <SettingsNavRow
              testID="settings-gps-link"
              icon="crosshairs-gps"
              title={titleOf('recording-gps-settings')}
              subtitle={gpsSummary}
              onPress={() => navigateTo('/recording-gps-settings')}
            />
            <SettingsNavRow
              testID="settings-auto-pause-link"
              icon="pause-circle-outline"
              title={titleOf('recording-auto-pause')}
              subtitle={autoPauseSummary}
              onPress={() => navigateTo('/recording-auto-pause')}
            />
            <SettingsNavRow
              testID="settings-upload-link"
              icon="cloud-upload-outline"
              title={titleOf('recording-upload')}
              subtitle={uploadSummary}
              onPress={() => navigateTo('/recording-upload')}
            />
            <SettingsNavRow
              testID="settings-units-link"
              icon="ruler"
              title={t('settings.units')}
              subtitle={t(isMetric ? 'settings.unitsMetric' : 'settings.unitsImperial')}
              onPress={() => navigateTo('/display-settings')}
            />
          </Card>
        </View>
      </ScreenScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingTop: spacing.sm },
  section: { paddingHorizontal: spacing.md, marginBottom: spacing.lg },
});

export default withScreenBoundary(RecordingSettingsScreenContent, 'RecordingSettings');
