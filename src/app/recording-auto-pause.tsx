import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import {
  Card,
  Row,
  RowDivider,
  ScreenSafeAreaView,
  ScreenScrollView,
  SwitchRow,
} from '@/shared/ui';
import { Stepper, type StepperScale } from '@/shared/ui/Stepper';
import { useTranslation } from 'react-i18next';
import { useTheme, useMetricSystem } from '@/shared/app';
import { KM_TO_MI, MPS_TO_KPH, formatSpeed } from '@/shared/format/format';
import { colors, darkColors, spacing, typography } from '@/theme';
import {
  AUTO_PAUSE_DURATION_BOUNDS_MS,
  AUTO_PAUSE_THRESHOLD_BOUNDS_KMH,
  useRecordingPreferences,
} from '@/features/recording';
import { DEFAULT_AUTO_PAUSE_KMH, type SportCategory } from '@/shared/recording';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { formatDecimal } from '@/shared/format';

/** Each stepper steps a whole unit of the athlete's own system, over a value stored in km/h. */
const THRESHOLD_SCALE: Record<'metric' | 'imperial', StepperScale> = {
  metric: { perStored: 1, step: 0.5 },
  imperial: { perStored: KM_TO_MI, step: 0.5 },
};
const DELAY_SCALE: StepperScale = { perStored: 1, step: 500 };

const SPORT_THRESHOLDS: {
  key: SportCategory;
  labelKey: string;
  fallback: string;
}[] = [
  { key: 'cycling', labelKey: 'recording.categories.cycling', fallback: 'Cycling' },
  { key: 'running', labelKey: 'recording.categories.running', fallback: 'Running' },
  {
    key: 'walking',
    labelKey: 'recording.settingsAutoPauseWalkingAndOther',
    fallback: 'Walking and other sports',
  },
];

function RecordingAutoPauseScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();

  const autoPauseEnabled = useRecordingPreferences((s) => s.autoPauseEnabled);
  const autoPauseThresholds = useRecordingPreferences((s) => s.autoPauseThresholds);
  const autoPauseDurationMs = useRecordingPreferences((s) => s.autoPauseDurationMs);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.surfacePage : colors.surfacePage;

  const handleToggleAutoPause = useCallback((value: boolean) => {
    useRecordingPreferences.getState().setAutoPause(value);
  }, []);
  const handleSetAutoPauseDelay = useCallback((ms: number) => {
    useRecordingPreferences.getState().setAutoPauseDuration(ms);
  }, []);
  const handleSetThreshold = useCallback((sport: SportCategory, kmh: number) => {
    useRecordingPreferences.getState().setAutoPauseThreshold(sport, kmh);
  }, []);

  const formatDelay = useCallback(
    (ms: number) => `${formatDecimal(ms / 1000, 1)} ${t('units.seconds')}`,
    [t]
  );
  const formatThreshold = useCallback(
    (kmh: number) => formatSpeed(kmh / MPS_TO_KPH, isMetric),
    [isMetric]
  );
  const unitSystem = isMetric ? 'metric' : 'imperial';

  return (
    <ScreenSafeAreaView
      testID="recording-auto-pause-screen"
      style={[styles.container, { backgroundColor: bg }]}
    >
      <ScreenScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <Card variant="flat">
            <SwitchRow
              inset="none"
              title={t('recording.settingsAutoPause')}
              value={autoPauseEnabled}
              onValueChange={handleToggleAutoPause}
              testID="settings-auto-pause"
            />

            {autoPauseEnabled ? (
              <View style={styles.thresholdList}>
                <>
                  <RowDivider inset="none" />
                  <Row inset="none">
                    <Text style={[styles.thresholdLabel, { color: textPrimary }]}>
                      {t('recording.autoPauseDelay', 'Auto-pause delay')}
                    </Text>
                    <Stepper
                      testID="settings-auto-pause-delay"
                      accessibilityLabel={t('recording.autoPauseDelay', 'Auto-pause delay')}
                      decrementLabel={t('recording.autoPauseDelayDecrease')}
                      incrementLabel={t('recording.autoPauseDelayIncrease')}
                      value={autoPauseDurationMs}
                      {...AUTO_PAUSE_DURATION_BOUNDS_MS}
                      scale={DELAY_SCALE}
                      format={formatDelay}
                      onChange={handleSetAutoPauseDelay}
                    />
                  </Row>
                </>
                <Text style={[styles.thresholdTitle, { color: textSecondary }]}>
                  {t('recording.settingsAutoPauseThreshold')}
                </Text>
                {SPORT_THRESHOLDS.map((sport) => {
                  const value = autoPauseThresholds[sport.key] ?? DEFAULT_AUTO_PAUSE_KMH[sport.key];
                  const sportLabel = t(sport.labelKey, sport.fallback);
                  return (
                    <React.Fragment key={sport.key}>
                      <RowDivider inset="none" />
                      <Row inset="none" testID={`settings-threshold-${sport.key}`}>
                        <Text style={[styles.thresholdLabel, { color: textPrimary }]}>
                          {sportLabel}
                        </Text>
                        <Stepper
                          testID={`settings-threshold-${sport.key}`}
                          accessibilityLabel={sportLabel}
                          decrementLabel={t('recording.speedThresholdDecrease', {
                            sport: sportLabel,
                          })}
                          incrementLabel={t('recording.speedThresholdIncrease', {
                            sport: sportLabel,
                          })}
                          value={value}
                          {...AUTO_PAUSE_THRESHOLD_BOUNDS_KMH}
                          scale={THRESHOLD_SCALE[unitSystem]}
                          format={formatThreshold}
                          onChange={(kmh) => handleSetThreshold(sport.key, kmh)}
                        />
                      </Row>
                    </React.Fragment>
                  );
                })}
              </View>
            ) : null}
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
  thresholdList: { marginTop: spacing.md },
  thresholdTitle: { ...typography.caption, marginBottom: spacing.sm },
  thresholdLabel: { ...typography.body, flex: 1 },
});

export default withScreenBoundary(RecordingAutoPauseScreenContent, 'RecordingAutoPause');
