import React, { useCallback } from 'react';
import { View, StyleSheet, Pressable, Switch } from 'react-native';
import { Text } from 'react-native-paper';
import {
  ListSectionHeader,
  ScreenSafeAreaView,
  ScreenScrollView,
  useTabBarClearance,
} from '@/shared/ui';
import { ToggleButton } from '@/shared/ui/Button';
import { Stepper, type StepperScale } from '@/shared/ui/Stepper';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, useMetricSystem } from '@/shared/app';
import {
  KM_TO_MI,
  MPS_TO_KPH,
  M_TO_FT,
  formatElevation,
  formatSpeed,
} from '@/shared/format/format';
import { colors, colorWithOpacity, darkColors, spacing, layout, typography, brand } from '@/theme';
import { tapTo } from '@/shared/app/navigation';
import {
  ACCURACY_REJECT_BOUNDS_M,
  AUTO_PAUSE_DURATION_BOUNDS_MS,
  AUTO_PAUSE_THRESHOLD_BOUNDS_KMH,
  useRecordingPreferences,
  type GpsAccuracyMode,
} from '@/features/recording';
import { DEFAULT_AUTO_PAUSE_KMH, type SportCategory } from '@/shared/recording';
import type { DataFieldType } from '@/types';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

const GPS_MODES: GpsAccuracyMode[] = ['high', 'balanced', 'batterySaver'];

/** Each stepper steps a whole unit of the athlete's own system, over a value stored in metric. */
const ACCURACY_SCALE: Record<'metric' | 'imperial', StepperScale> = {
  metric: { perStored: 1, step: 5 },
  imperial: { perStored: M_TO_FT, step: 15 },
};
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
  {
    key: 'cycling',
    labelKey: 'recording.categories.cycling',
    fallback: 'Cycling',
  },
  {
    key: 'running',
    labelKey: 'recording.categories.running',
    fallback: 'Running',
  },
  {
    key: 'walking',
    labelKey: 'recording.settingsAutoPauseWalkingAndOther',
    fallback: 'Walking and other sports',
  },
];

const ALL_DATA_FIELDS: DataFieldType[] = [
  'speed',
  'avgSpeed',
  'distance',
  'heartrate',
  'power',
  'cadence',
  'elevation',
  'elevationGain',
  'pace',
  'avgPace',
  'timer',
  'movingTime',
  'lapTime',
  'lapDistance',
  'calories',
];

const FIELD_MODES = ['gps', 'indoor'] as const;

const MODE_LABEL_KEYS = {
  gps: 'recording.fieldModeGps',
  indoor: 'recording.fieldModeIndoor',
} as const;

function RecordingSettingsScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const tabBarClearance = useTabBarClearance();
  const isMetric = useMetricSystem();

  const autoPauseEnabled = useRecordingPreferences((s) => s.autoPauseEnabled);
  const autoPauseThresholds = useRecordingPreferences((s) => s.autoPauseThresholds);
  const dataFields = useRecordingPreferences((s) => s.dataFields);
  const autoUploadEnabled = useRecordingPreferences((s) => s.autoUploadEnabled);
  const gpsAccuracyMode = useRecordingPreferences((s) => s.gpsAccuracyMode);
  const accuracyRejectThreshold = useRecordingPreferences((s) => s.accuracyRejectThreshold);
  const autoPauseDurationMs = useRecordingPreferences((s) => s.autoPauseDurationMs);
  const keepAwakeEnabled = useRecordingPreferences((s) => s.keepAwakeEnabled);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;

  const handleToggleAutoPause = useCallback((value: boolean) => {
    useRecordingPreferences.getState().setAutoPause(value);
  }, []);

  const handleToggleAutoUpload = useCallback((value: boolean) => {
    useRecordingPreferences.getState().setAutoUpload(value);
  }, []);

  const handleToggleKeepAwake = useCallback((value: boolean) => {
    useRecordingPreferences.getState().setKeepAwake(value);
  }, []);

  const handleSelectGpsMode = useCallback((mode: GpsAccuracyMode) => {
    useRecordingPreferences.getState().setGpsAccuracyMode(mode);
  }, []);

  const handleSetAccuracyFilter = useCallback((metres: number) => {
    useRecordingPreferences.getState().setAccuracyRejectThreshold(metres);
  }, []);

  const handleSetAutoPauseDelay = useCallback((ms: number) => {
    useRecordingPreferences.getState().setAutoPauseDuration(ms);
  }, []);

  const handleSetThreshold = useCallback((sport: SportCategory, kmh: number) => {
    useRecordingPreferences.getState().setAutoPauseThreshold(sport, kmh);
  }, []);

  const formatAccuracy = useCallback(
    (metres: number) => formatElevation(metres, isMetric),
    [isMetric]
  );
  const formatDelay = useCallback(
    (ms: number) => `${(ms / 1000).toFixed(1)} ${t('units.seconds')}`,
    [t]
  );
  const formatThreshold = useCallback(
    (kmh: number) => formatSpeed(kmh / MPS_TO_KPH, isMetric),
    [isMetric]
  );
  const unitSystem = isMetric ? 'metric' : 'imperial';

  const handleToggleField = useCallback((mode: string, field: DataFieldType) => {
    const current = useRecordingPreferences.getState().dataFields[mode] ?? [];
    const isSelected = current.includes(field);
    let updated: DataFieldType[];
    if (isSelected) {
      // Don't allow removing all fields
      if (current.length <= 1) return;
      updated = current.filter((f) => f !== field);
    } else {
      updated = [...current, field];
    }
    useRecordingPreferences.getState().setDataFields(mode, updated);
  }, []);

  return (
    <ScreenSafeAreaView
      hasNativeHeader
      testID="recording-settings-screen"
      style={[styles.container, { backgroundColor: bg }]}
    >
      <ScreenScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance }]}
      >
        {/* Upload Section */}
        <View style={styles.section}>
          <ListSectionHeader inset={false}>
            {t('recording.settingsUpload', 'Upload')}
          </ListSectionHeader>
          <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
            <View style={styles.switchRow}>
              <View style={styles.switchLabelBlock}>
                <Text style={[styles.rowLabel, { color: textPrimary }]}>
                  {t('recording.autoUpload', 'Auto-upload')}
                </Text>
                <Text style={[styles.rowDescription, { color: textSecondary }]}>
                  {t(
                    'recording.autoUploadDescription',
                    'Upload recordings to intervals.icu automatically when you save them. Off keeps them on this device until you upload from My Recordings.'
                  )}
                </Text>
              </View>
              <Switch
                testID="settings-auto-upload"
                value={autoUploadEnabled}
                onValueChange={handleToggleAutoUpload}
                trackColor={{
                  false: colors.iconNeutral,
                  true: colorWithOpacity(brand.teal, 0.38),
                }}
                thumbColor={autoUploadEnabled ? brand.teal : colors.background}
              />
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('recording.library.title', 'My Recordings')}
            testID="settings-recordings-link"
            style={pressable([
              styles.linkCard,
              {
                backgroundColor: surface,
                borderColor: border,
                marginTop: spacing.sm,
              },
            ])}
            android_ripple={pressRipple}
            onPress={() => tapTo('/recordings')}
          >
            <MaterialCommunityIcons name="folder-play-outline" size={20} color={textSecondary} />
            <Text style={[styles.linkText, { color: textPrimary }]}>
              {t('recording.library.title', 'My Recordings')}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={textSecondary} />
          </Pressable>
        </View>

        {/* GPS & Battery Section */}
        <View style={styles.section}>
          <ListSectionHeader inset={false}>
            {t('recording.settingsGps', 'GPS & Battery')}
          </ListSectionHeader>
          <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
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
              {GPS_MODES.map((mode) => {
                const isSelected = gpsAccuracyMode === mode;
                return (
                  <ToggleButton
                    key={mode}
                    testID={`settings-gps-mode-${mode}`}
                    style={styles.gpsModeChip}
                    label={t(`recording.gpsModes.${mode}`)}
                    selected={isSelected}
                    onPress={() => handleSelectGpsMode(mode)}
                  />
                );
              })}
            </View>

            <View style={[styles.thresholdRow, { borderTopColor: border }]}>
              <View style={styles.switchLabelBlock}>
                <Text style={[styles.thresholdLabel, { color: textPrimary }]}>
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
                scale={ACCURACY_SCALE[unitSystem]}
                format={formatAccuracy}
                onChange={handleSetAccuracyFilter}
              />
            </View>

            <View style={[styles.thresholdRow, { borderTopColor: border }]}>
              <View style={styles.switchLabelBlock}>
                <Text style={[styles.thresholdLabel, { color: textPrimary }]}>
                  {t('recording.keepAwake', 'Keep screen awake')}
                </Text>
                <Text style={[styles.rowDescription, { color: textSecondary }]}>
                  {t(
                    'recording.keepAwakeDescription',
                    'Prevent the screen from sleeping during recording.'
                  )}
                </Text>
              </View>
              <Switch
                testID="settings-keep-awake"
                value={keepAwakeEnabled}
                onValueChange={handleToggleKeepAwake}
                trackColor={{
                  false: colors.iconNeutral,
                  true: colorWithOpacity(brand.teal, 0.38),
                }}
                thumbColor={keepAwakeEnabled ? brand.teal : colors.background}
              />
            </View>
          </View>
        </View>

        {/* Auto-Pause Section */}
        <View style={styles.section}>
          <ListSectionHeader inset={false}>{t('recording.settingsAutoPause')}</ListSectionHeader>

          <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
            <View style={styles.switchRow}>
              <Text style={[styles.rowLabel, { color: textPrimary }]}>
                {t('recording.settingsAutoPause')}
              </Text>
              <Switch
                testID="settings-auto-pause"
                value={autoPauseEnabled}
                onValueChange={handleToggleAutoPause}
                trackColor={{
                  false: colors.iconNeutral,
                  true: colorWithOpacity(brand.teal, 0.38),
                }}
                thumbColor={autoPauseEnabled ? brand.teal : colors.background}
              />
            </View>

            {autoPauseEnabled && (
              <View style={styles.thresholdList}>
                <View style={[styles.thresholdRow, { borderTopColor: border }]}>
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
                </View>
                <Text style={[styles.thresholdTitle, { color: textSecondary }]}>
                  {t('recording.settingsAutoPauseThreshold')}
                </Text>
                {SPORT_THRESHOLDS.map((sport) => {
                  const value = autoPauseThresholds[sport.key] ?? DEFAULT_AUTO_PAUSE_KMH[sport.key];
                  const sportLabel = t(sport.labelKey, sport.fallback);
                  return (
                    <View
                      key={sport.key}
                      testID={`settings-threshold-${sport.key}`}
                      style={[styles.thresholdRow, { borderTopColor: border }]}
                    >
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
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>

        {/* Data Fields Section */}
        <View style={styles.section}>
          <ListSectionHeader inset={false}>{t('recording.settingsDataFields')}</ListSectionHeader>

          {FIELD_MODES.map((mode) => {
            const selectedFields = dataFields[mode] ?? [];
            return (
              <View
                key={mode}
                style={[
                  styles.card,
                  {
                    backgroundColor: surface,
                    borderColor: border,
                    marginBottom: spacing.sm,
                  },
                ]}
              >
                <Text style={[styles.modeLabel, { color: textPrimary }]}>
                  {t(MODE_LABEL_KEYS[mode])}
                </Text>
                <View style={styles.fieldGrid}>
                  {ALL_DATA_FIELDS.map((field) => {
                    const isSelected = selectedFields.includes(field);
                    return (
                      <ToggleButton
                        key={field}
                        testID={`settings-field-${mode}-${field}`}
                        label={t(`recording.fields.${field}`)}
                        selected={isSelected}
                        onPress={() => handleToggleField(mode, field)}
                      />
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>

        {/* Sensors Link */}
        <View style={styles.section}>
          <ListSectionHeader inset={false}>{t('sensors.title', 'Sensors')}</ListSectionHeader>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('sensors.manageSensors', 'Heart rate, power & cadence sensors')}
            testID="settings-sensors-link"
            style={pressable([styles.linkCard, { backgroundColor: surface, borderColor: border }])}
            android_ripple={pressRipple}
            onPress={() => tapTo('/sensor-settings')}
          >
            <MaterialCommunityIcons name="bluetooth" size={20} color={textSecondary} />
            <Text style={[styles.linkText, { color: textPrimary }]}>
              {t('sensors.manageSensors', 'Heart rate, power & cadence sensors')}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={textSecondary} />
          </Pressable>
        </View>

        {/* Units Link */}
        <View style={styles.section}>
          <ListSectionHeader inset={false}>{t('recording.settingsUnits')}</ListSectionHeader>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('settings.units')}
            style={pressable([styles.linkCard, { backgroundColor: surface, borderColor: border }])}
            android_ripple={pressRipple}
            onPress={() => tapTo('/display-settings')}
          >
            <MaterialCommunityIcons name="ruler" size={20} color={textSecondary} />
            <Text style={[styles.linkText, { color: textPrimary }]}>{t('settings.units')}</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={textSecondary} />
          </Pressable>
        </View>
      </ScreenScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: spacing.sm,
  },
  section: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  card: {
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: {
    ...typography.body,
  },
  switchLabelBlock: {
    flex: 1,
    marginRight: spacing.md,
  },
  rowDescription: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
  thresholdList: {
    marginTop: spacing.md,
  },
  thresholdTitle: {
    ...typography.caption,
    marginBottom: spacing.sm,
  },
  thresholdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  thresholdLabel: {
    ...typography.body,
  },
  modeLabel: {
    ...typography.bodyBold,
    marginBottom: spacing.sm,
  },
  fieldGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  gpsModeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  gpsModeChip: {
    flex: 1,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  linkText: {
    ...typography.body,
    flex: 1,
  },
});

export default withScreenBoundary(RecordingSettingsScreenContent, 'RecordingSettings');
