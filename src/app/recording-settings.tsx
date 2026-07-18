import React, { useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import { Text } from 'react-native-paper';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, layout, typography, brand } from '@/theme';
import { navigateTo } from '@/shared/app/navigation';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import type { GpsAccuracyMode } from '@/features/recording/stores/RecordingPreferencesStore';
import type { DataFieldType } from '@/types';

const GPS_MODES: GpsAccuracyMode[] = ['high', 'balanced', 'batterySaver'];

const SPORT_THRESHOLDS = [
  { key: 'cycling', label: 'Cycling', defaultKmh: 2 },
  { key: 'running', label: 'Running', defaultKmh: 1 },
  { key: 'walking', label: 'Walking', defaultKmh: 0.5 },
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

const MODE_LABELS: Record<string, string> = {
  gps: 'GPS',
  indoor: 'Indoor',
};

export default function RecordingSettingsScreen() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

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

  const handleAdjustAccuracyFilter = useCallback((delta: number) => {
    const current = useRecordingPreferences.getState().accuracyRejectThreshold;
    useRecordingPreferences
      .getState()
      .setAccuracyRejectThreshold(Math.max(10, Math.min(100, current + delta)));
  }, []);

  const handleAdjustAutoPauseDelay = useCallback((deltaMs: number) => {
    const current = useRecordingPreferences.getState().autoPauseDurationMs;
    useRecordingPreferences
      .getState()
      .setAutoPauseDuration(Math.max(1000, Math.min(10_000, current + deltaMs)));
  }, []);

  const handleAdjustThreshold = useCallback((sport: string, delta: number) => {
    const current = useRecordingPreferences.getState().autoPauseThresholds[sport] ?? 1;
    const next = Math.max(0.5, Math.min(10, current + delta));
    useRecordingPreferences.getState().setAutoPauseThreshold(sport, Math.round(next * 10) / 10);
  }, []);

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
      testID="recording-settings-screen"
      style={[styles.container, { backgroundColor: bg }]}
    >
      <View style={styles.header}>
        <TouchableOpacity
          testID="recording-settings-back"
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textPrimary }]}>{t('recording.settings')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + TAB_BAR_SAFE_PADDING },
        ]}
      >
        {/* Upload Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: textSecondary }]}>
            {t('recording.settingsUpload', 'Upload')}
          </Text>
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
                trackColor={{ false: '#767577', true: brand.teal + '60' }}
                thumbColor={autoUploadEnabled ? brand.teal : '#f4f3f4'}
              />
            </View>
          </View>
          <TouchableOpacity
            testID="settings-recordings-link"
            style={[
              styles.linkCard,
              { backgroundColor: surface, borderColor: border, marginTop: spacing.sm },
            ]}
            onPress={() => navigateTo('/recordings')}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="folder-play-outline" size={20} color={textSecondary} />
            <Text style={[styles.linkText, { color: textPrimary }]}>
              {t('recording.library.title', 'My Recordings')}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={textSecondary} />
          </TouchableOpacity>
        </View>

        {/* GPS & Battery Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: textSecondary }]}>
            {t('recording.settingsGps', 'GPS & Battery')}
          </Text>
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
                  <TouchableOpacity
                    key={mode}
                    testID={`settings-gps-mode-${mode}`}
                    style={[
                      styles.gpsModeChip,
                      {
                        backgroundColor: isSelected
                          ? brand.teal + '20'
                          : isDark
                            ? darkColors.background
                            : colors.background,
                        borderColor: isSelected ? brand.teal : border,
                      },
                    ]}
                    onPress={() => handleSelectGpsMode(mode)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.fieldChipText,
                        { color: isSelected ? brand.teal : textSecondary },
                      ]}
                      numberOfLines={1}
                    >
                      {t(`recording.gpsModes.${mode}`)}
                    </Text>
                  </TouchableOpacity>
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
              <View style={styles.thresholdControls}>
                <TouchableOpacity
                  testID="settings-accuracy-filter-minus"
                  onPress={() => handleAdjustAccuracyFilter(-5)}
                  style={[styles.thresholdBtn, { borderColor: border }]}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="minus" size={16} color={textSecondary} />
                </TouchableOpacity>
                <Text style={[styles.thresholdValue, { color: textPrimary }]}>
                  {accuracyRejectThreshold} m
                </Text>
                <TouchableOpacity
                  testID="settings-accuracy-filter-plus"
                  onPress={() => handleAdjustAccuracyFilter(5)}
                  style={[styles.thresholdBtn, { borderColor: border }]}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="plus" size={16} color={textSecondary} />
                </TouchableOpacity>
              </View>
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
                trackColor={{ false: '#767577', true: brand.teal + '60' }}
                thumbColor={keepAwakeEnabled ? brand.teal : '#f4f3f4'}
              />
            </View>
          </View>
        </View>

        {/* Auto-Pause Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: textSecondary }]}>
            {t('recording.settingsAutoPause')}
          </Text>

          <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
            <View style={styles.switchRow}>
              <Text style={[styles.rowLabel, { color: textPrimary }]}>
                {t('recording.settingsAutoPause')}
              </Text>
              <Switch
                testID="settings-auto-pause"
                value={autoPauseEnabled}
                onValueChange={handleToggleAutoPause}
                trackColor={{ false: '#767577', true: brand.teal + '60' }}
                thumbColor={autoPauseEnabled ? brand.teal : '#f4f3f4'}
              />
            </View>

            {autoPauseEnabled && (
              <View style={styles.thresholdList}>
                <View style={[styles.thresholdRow, { borderTopColor: border }]}>
                  <Text style={[styles.thresholdLabel, { color: textPrimary }]}>
                    {t('recording.autoPauseDelay', 'Auto-pause delay')}
                  </Text>
                  <View style={styles.thresholdControls}>
                    <TouchableOpacity
                      testID="settings-auto-pause-delay-minus"
                      onPress={() => handleAdjustAutoPauseDelay(-500)}
                      style={[styles.thresholdBtn, { borderColor: border }]}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name="minus" size={16} color={textSecondary} />
                    </TouchableOpacity>
                    <Text style={[styles.thresholdValue, { color: textPrimary }]}>
                      {(autoPauseDurationMs / 1000).toFixed(1)} s
                    </Text>
                    <TouchableOpacity
                      testID="settings-auto-pause-delay-plus"
                      onPress={() => handleAdjustAutoPauseDelay(500)}
                      style={[styles.thresholdBtn, { borderColor: border }]}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name="plus" size={16} color={textSecondary} />
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={[styles.thresholdTitle, { color: textSecondary }]}>
                  {t('recording.settingsAutoPauseThreshold')}
                </Text>
                {SPORT_THRESHOLDS.map((sport) => {
                  const value = autoPauseThresholds[sport.key] ?? sport.defaultKmh;
                  return (
                    <View
                      key={sport.key}
                      testID={`settings-threshold-${sport.key}`}
                      style={[styles.thresholdRow, { borderTopColor: border }]}
                    >
                      <Text style={[styles.thresholdLabel, { color: textPrimary }]}>
                        {t(`recording.categories.${sport.key}`, sport.label)}
                      </Text>
                      <View style={styles.thresholdControls}>
                        <TouchableOpacity
                          testID={`settings-threshold-${sport.key}-minus`}
                          onPress={() => handleAdjustThreshold(sport.key, -0.5)}
                          style={[styles.thresholdBtn, { borderColor: border }]}
                          activeOpacity={0.7}
                        >
                          <MaterialCommunityIcons name="minus" size={16} color={textSecondary} />
                        </TouchableOpacity>
                        <Text style={[styles.thresholdValue, { color: textPrimary }]}>
                          {value.toFixed(1)} km/h
                        </Text>
                        <TouchableOpacity
                          testID={`settings-threshold-${sport.key}-plus`}
                          onPress={() => handleAdjustThreshold(sport.key, 0.5)}
                          style={[styles.thresholdBtn, { borderColor: border }]}
                          activeOpacity={0.7}
                        >
                          <MaterialCommunityIcons name="plus" size={16} color={textSecondary} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>

        {/* Data Fields Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: textSecondary }]}>
            {t('recording.settingsDataFields')}
          </Text>

          {FIELD_MODES.map((mode) => {
            const selectedFields = dataFields[mode] ?? [];
            return (
              <View
                key={mode}
                style={[
                  styles.card,
                  { backgroundColor: surface, borderColor: border, marginBottom: spacing.sm },
                ]}
              >
                <Text style={[styles.modeLabel, { color: textPrimary }]}>{MODE_LABELS[mode]}</Text>
                <View style={styles.fieldGrid}>
                  {ALL_DATA_FIELDS.map((field) => {
                    const isSelected = selectedFields.includes(field);
                    return (
                      <TouchableOpacity
                        key={field}
                        testID={`settings-field-${mode}-${field}`}
                        style={[
                          styles.fieldChip,
                          {
                            backgroundColor: isSelected
                              ? brand.teal + '20'
                              : isDark
                                ? darkColors.background
                                : colors.background,
                            borderColor: isSelected ? brand.teal : border,
                          },
                        ]}
                        onPress={() => handleToggleField(mode, field)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.fieldChipText,
                            { color: isSelected ? brand.teal : textSecondary },
                          ]}
                          numberOfLines={1}
                        >
                          {t(`recording.fields.${field}`)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>

        {/* Units Link */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: textSecondary }]}>
            {t('recording.settingsUnits')}
          </Text>
          <TouchableOpacity
            style={[styles.linkCard, { backgroundColor: surface, borderColor: border }]}
            onPress={() => navigateTo('/display-settings')}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="ruler" size={20} color={textSecondary} />
            <Text style={[styles.linkText, { color: textPrimary }]}>{t('settings.units')}</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={textSecondary} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backButton: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.sectionTitle,
    marginLeft: spacing.xs,
  },
  scrollContent: {
    paddingTop: spacing.sm,
  },
  section: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.label,
    marginBottom: spacing.sm,
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
    marginTop: 2,
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
  thresholdControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  thresholdBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thresholdValue: {
    ...typography.bodyBold,
    fontVariant: ['tabular-nums'],
    minWidth: 60,
    textAlign: 'center',
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
  fieldChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
    borderWidth: 1,
  },
  fieldChipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  gpsModeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  gpsModeChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: layout.borderRadiusSm,
    borderWidth: 1,
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
