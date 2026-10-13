import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import {
  ListSectionHeader,
  Row,
  ScreenSafeAreaView,
  ScreenScrollView,
  SwitchRow,
} from '@/shared/ui';
import { ToggleButton } from '@/shared/ui/Button';
import { Stepper, type StepperScale } from '@/shared/ui/Stepper';
import { useTranslation } from 'react-i18next';
import { useTheme, useMetricSystem } from '@/shared/app';
import {
  KM_TO_MI,
  MPS_TO_KPH,
  M_TO_FT,
  formatElevation,
  formatSpeed,
} from '@/shared/format/format';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { tapTo } from '@/shared/app/navigation';
import {
  ACCURACY_REJECT_BOUNDS_M,
  ALL_DATA_FIELDS,
  AUTO_PAUSE_DURATION_BOUNDS_MS,
  AUTO_PAUSE_THRESHOLD_BOUNDS_KMH,
  fieldsForMode,
  MAX_DATA_FIELDS,
  useRecordingPreferences,
  UploadPermissionNotice,
  type GpsAccuracyMode,
} from '@/features/recording';
import { useSheetOpener } from '@/shared/app/sheetRequest';
import type { FieldPickerSheetInput } from '@/app/sheets/field-picker';
import { SettingsNavRow } from '@/features/settings';
import { DEFAULT_AUTO_PAUSE_KMH, type SportCategory } from '@/shared/recording';
import type { DataFieldType } from '@/types';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { formatDecimal } from '@/shared/format';

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

const FIELD_MODES = ['gps', 'indoor'] as const;

const MODE_LABEL_KEYS = {
  gps: 'recording.fieldModeGps',
  indoor: 'recording.fieldModeIndoor',
} as const;

function RecordingSettingsScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
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
    (ms: number) => `${formatDecimal(ms / 1000, 1)} ${t('units.seconds')}`,
    [t]
  );
  const formatThreshold = useCallback(
    (kmh: number) => formatSpeed(kmh / MPS_TO_KPH, isMetric),
    [isMetric]
  );
  const unitSystem = isMetric ? 'metric' : 'imperial';

  const handleToggleField = useCallback((mode: string, field: DataFieldType) => {
    const current = fieldsForMode(useRecordingPreferences.getState().dataFields, mode);
    const isSelected = current.includes(field);
    let updated: DataFieldType[];
    if (isSelected) {
      // Don't allow removing all fields
      if (current.length <= 1) return;
      updated = current.filter((f) => f !== field);
    } else {
      if (current.length >= MAX_DATA_FIELDS) return;
      updated = [...current, field];
    }
    useRecordingPreferences.getState().setDataFields(mode, updated);
  }, []);

  // The same picker and the same write as a hold on a live tile, so the order can
  // be set by someone who never finds the hold.
  const openSheet = useSheetOpener();
  const handleEditTile = useCallback(
    async (mode: string, index: number) => {
      const current = fieldsForMode(useRecordingPreferences.getState().dataFields, mode);
      const result = await openSheet<FieldPickerSheetInput, DataFieldType>('sheets/field-picker', {
        selectedField: current[index] ?? null,
      });
      if (result.kind === 'selected') {
        useRecordingPreferences.getState().setSlotField(mode, index, result.value);
      }
    },
    [openSheet]
  );

  return (
    <ScreenSafeAreaView
      hasNativeHeader
      testID="recording-settings-screen"
      style={[styles.container, { backgroundColor: bg }]}
    >
      <ScreenScrollView contentContainerStyle={styles.scrollContent}>
        {/* Upload Section */}
        <View style={styles.section}>
          <ListSectionHeader inset={false}>
            {t('recording.settingsUpload', 'Upload')}
          </ListSectionHeader>
          <View
            testID="settings-upload-card"
            style={[styles.card, { backgroundColor: surface, borderColor: border }]}
          >
            <SwitchRow
              inset="none"
              title={t('recording.autoUpload', 'Auto-upload')}
              description={t(
                'recording.autoUploadDescription',
                'Upload recordings to intervals.icu automatically when you save them. Off keeps them on this device until you upload from My Recordings.'
              )}
              value={autoUploadEnabled}
              onValueChange={handleToggleAutoUpload}
              testID="settings-auto-upload"
            />
            <UploadPermissionNotice />
          </View>
          <View
            style={[
              styles.linkCard,
              { backgroundColor: surface, borderColor: border, marginTop: spacing.sm },
            ]}
          >
            <SettingsNavRow
              testID="settings-recordings-link"
              icon="folder-play-outline"
              title={t('recording.library.title', 'My Recordings')}
              onPress={() => tapTo('/recordings')}
            />
          </View>
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

            <View style={[styles.dividedRow, { borderTopColor: border }]}>
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
          </View>
        </View>

        {/* Auto-Pause Section */}
        <View style={styles.section}>
          <ListSectionHeader inset={false}>{t('recording.settingsAutoPause')}</ListSectionHeader>

          <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
            <SwitchRow
              inset="none"
              title={t('recording.settingsAutoPause')}
              value={autoPauseEnabled}
              onValueChange={handleToggleAutoPause}
              testID="settings-auto-pause"
            />

            {autoPauseEnabled ? (
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
            ) : null}
          </View>
        </View>

        {/* Data Fields Section */}
        <View style={styles.section}>
          <ListSectionHeader inset={false}>{t('recording.settingsDataFields')}</ListSectionHeader>

          {FIELD_MODES.map((mode) => {
            const selectedFields = fieldsForMode(dataFields, mode);
            const atCap = selectedFields.length >= MAX_DATA_FIELDS;
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
                <View style={styles.modeHeader}>
                  <Text style={[styles.modeLabel, { color: textPrimary }]}>
                    {t(MODE_LABEL_KEYS[mode])}
                  </Text>
                  <Text
                    testID={`settings-field-count-${mode}`}
                    style={[styles.fieldCount, { color: textSecondary }]}
                  >
                    {t('recording.fieldsSelected', {
                      selected: selectedFields.length,
                      max: MAX_DATA_FIELDS,
                    })}
                  </Text>
                </View>
                <View style={styles.fieldGrid}>
                  {ALL_DATA_FIELDS.map((field) => {
                    const isSelected = selectedFields.includes(field);
                    return (
                      <ToggleButton
                        key={field}
                        testID={`settings-field-${mode}-${field}`}
                        label={t(`recording.fields.${field}`)}
                        selected={isSelected}
                        disabled={atCap ? !isSelected : false}
                        onPress={() => handleToggleField(mode, field)}
                      />
                    );
                  })}
                </View>
                <Text style={[styles.tileOrderTitle, { color: textPrimary }]}>
                  {t('recording.tileOrder')}
                </Text>
                <Text style={[styles.rowDescription, { color: textSecondary }]}>
                  {t('recording.tileOrderDescription')}
                </Text>
                <View style={styles.tileOrderList}>
                  {selectedFields.map((field, index) => {
                    const fieldLabel = t(`recording.fields.${field}`);
                    return (
                      <Row
                        key={field}
                        testID={`settings-tile-${mode}-${index}`}
                        behaviour="navigate"
                        accessibilityLabel={t('recording.tileSlotLabel', {
                          number: index + 1,
                          field: fieldLabel,
                        })}
                        onPress={() => handleEditTile(mode, index)}
                      >
                        <Text style={[styles.tileNumber, { color: textSecondary }]}>
                          {index + 1}
                        </Text>
                        <Text style={[styles.linkText, { color: textPrimary }]}>{fieldLabel}</Text>
                      </Row>
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
          <View style={[styles.linkCard, { backgroundColor: surface, borderColor: border }]}>
            <SettingsNavRow
              testID="settings-sensors-link"
              icon="bluetooth"
              title={t('sensors.manageSensors', 'Heart rate, power & cadence sensors')}
              onPress={() => tapTo('/sensor-settings')}
            />
          </View>
        </View>

        {/* Units Link */}
        <View style={styles.section}>
          <ListSectionHeader inset={false}>{t('recording.settingsUnits')}</ListSectionHeader>
          <View style={[styles.linkCard, { backgroundColor: surface, borderColor: border }]}>
            <SettingsNavRow
              icon="ruler"
              title={t('settings.units')}
              onPress={() => tapTo('/display-settings')}
            />
          </View>
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
  dividedRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
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
  modeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  modeLabel: {
    ...typography.bodyBold,
  },
  fieldCount: {
    ...typography.caption,
  },
  fieldGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  tileOrderTitle: {
    ...typography.bodyBold,
    marginTop: spacing.md,
  },
  tileOrderList: {
    marginTop: spacing.xs,
    marginHorizontal: -spacing.md,
    marginBottom: -spacing.md,
  },
  tileNumber: {
    ...typography.bodyBold,
    fontVariant: ['tabular-nums'],
    minWidth: spacing.lg,
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
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  linkText: {
    ...typography.body,
    flex: 1,
  },
});

export default withScreenBoundary(RecordingSettingsScreenContent, 'RecordingSettings');
