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
import { ToggleButton } from '@/shared/ui/Button';
import { Stepper, type StepperScale } from '@/shared/ui/Stepper';
import { useTranslation } from 'react-i18next';
import { useTheme, useMetricSystem } from '@/shared/app';
import { M_TO_FT, formatElevation } from '@/shared/format/format';
import { colors, darkColors, spacing, typography } from '@/theme';
import {
  ACCURACY_REJECT_BOUNDS_M,
  useRecordingPreferences,
  type GpsAccuracyMode,
} from '@/features/recording';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

const GPS_MODES: GpsAccuracyMode[] = ['high', 'balanced', 'batterySaver'];

/** The stepper steps a whole unit of the athlete's own system, over a value stored in metres. */
const ACCURACY_SCALE: Record<'metric' | 'imperial', StepperScale> = {
  metric: { perStored: 1, step: 5 },
  imperial: { perStored: M_TO_FT, step: 15 },
};

function RecordingGpsScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();

  const gpsAccuracyMode = useRecordingPreferences((s) => s.gpsAccuracyMode);
  const accuracyRejectThreshold = useRecordingPreferences((s) => s.accuracyRejectThreshold);
  const keepAwakeEnabled = useRecordingPreferences((s) => s.keepAwakeEnabled);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.surfacePage : colors.surfacePage;

  const handleToggleKeepAwake = useCallback((value: boolean) => {
    useRecordingPreferences.getState().setKeepAwake(value);
  }, []);
  const handleSelectGpsMode = useCallback((mode: GpsAccuracyMode) => {
    useRecordingPreferences.getState().setGpsAccuracyMode(mode);
  }, []);
  const handleSetAccuracyFilter = useCallback((metres: number) => {
    useRecordingPreferences.getState().setAccuracyRejectThreshold(metres);
  }, []);
  const formatAccuracy = useCallback(
    (metres: number) => formatElevation(metres, isMetric),
    [isMetric]
  );

  return (
    <ScreenSafeAreaView
      testID="recording-gps-screen"
      style={[styles.container, { backgroundColor: bg }]}
    >
      <ScreenScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <Card variant="flat">
            <Text style={[styles.rowLabel, { color: textPrimary }]}>
              {t('recording.gpsMode', 'GPS accuracy')}
            </Text>
            <Text style={[styles.rowDescription, { color: textSecondary }]}>
              {t(
                'recording.gpsModeDescription',
                'Higher accuracy records more points and uses more battery.'
              )}
            </Text>
            <View style={styles.gpsModeRow}>
              {GPS_MODES.map((mode) => (
                <ToggleButton
                  key={mode}
                  testID={`settings-gps-mode-${mode}`}
                  style={styles.gpsModeChip}
                  label={t(`recording.gpsModes.${mode}`)}
                  selected={gpsAccuracyMode === mode}
                  onPress={() => handleSelectGpsMode(mode)}
                />
              ))}
            </View>

            <RowDivider inset="none" />
            <Row inset="none">
              <View style={styles.switchLabelBlock}>
                <Text style={[styles.rowLabel, { color: textPrimary }]}>
                  {t('recording.accuracyFilter', 'Accuracy filter')}
                </Text>
                <Text style={[styles.rowDescription, { color: textSecondary }]}>
                  {t(
                    'recording.accuracyFilterDescription',
                    'Discard GPS points less accurate than this.'
                  )}
                </Text>
              </View>
              <Stepper
                testID="settings-accuracy-filter"
                accessibilityLabel={t('recording.accuracyFilter', 'Accuracy filter')}
                decrementLabel={t('recording.accuracyFilterDecrease')}
                incrementLabel={t('recording.accuracyFilterIncrease')}
                value={accuracyRejectThreshold}
                {...ACCURACY_REJECT_BOUNDS_M}
                scale={ACCURACY_SCALE[isMetric ? 'metric' : 'imperial']}
                format={formatAccuracy}
                onChange={handleSetAccuracyFilter}
              />
            </Row>

            <RowDivider inset="none" />
            <View>
              <SwitchRow
                inset="none"
                title={t('recording.keepAwake', 'Keep screen awake')}
                description={t(
                  'recording.keepAwakeDescription',
                  'Prevent the screen from sleeping during recording.'
                )}
                value={keepAwakeEnabled}
                onValueChange={handleToggleKeepAwake}
                testID="settings-keep-awake"
              />
            </View>
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
  rowLabel: { ...typography.body },
  switchLabelBlock: { flex: 1, marginRight: spacing.md },
  rowDescription: { ...typography.caption, marginTop: spacing.xxs },
  gpsModeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  gpsModeChip: { flex: 1 },
});

export default withScreenBoundary(RecordingGpsScreenContent, 'RecordingGps');
