import React, { useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import { Text } from 'react-native-paper';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, layout, typography, brand } from '@/theme';
import { useRecordingPreferences } from '@/providers/RecordingPreferencesStore';
import type { DataFieldType } from '@/types';

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

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;

  const handleToggleAutoPause = useCallback((value: boolean) => {
    useRecordingPreferences.getState().setAutoPause(value);
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
    <ScreenSafeAreaView style={[styles.container, { backgroundColor: bg }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textPrimary }]}>
          {t('recording.settings')}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + TAB_BAR_SAFE_PADDING },
        ]}
      >
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
                value={autoPauseEnabled}
                onValueChange={handleToggleAutoPause}
                trackColor={{ false: '#767577', true: brand.teal + '60' }}
                thumbColor={autoPauseEnabled ? brand.teal : '#f4f3f4'}
              />
            </View>

            {autoPauseEnabled && (
              <View style={styles.thresholdList}>
                <Text style={[styles.thresholdTitle, { color: textSecondary }]}>
                  {t('recording.settingsAutoPauseThreshold')}
                </Text>
                {SPORT_THRESHOLDS.map((sport) => {
                  const value = autoPauseThresholds[sport.key] ?? sport.defaultKmh;
                  return (
                    <View key={sport.key} style={[styles.thresholdRow, { borderTopColor: border }]}>
                      <Text style={[styles.thresholdLabel, { color: textPrimary }]}>
                        {t(`recording.categories.${sport.key}`, sport.label)}
                      </Text>
                      <View style={styles.thresholdControls}>
                        <TouchableOpacity
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
                style={[styles.card, { backgroundColor: surface, borderColor: border, marginBottom: spacing.sm }]}
              >
                <Text style={[styles.modeLabel, { color: textPrimary }]}>
                  {MODE_LABELS[mode]}
                </Text>
                <View style={styles.fieldGrid}>
                  {ALL_DATA_FIELDS.map((field) => {
                    const isSelected = selectedFields.includes(field);
                    return (
                      <TouchableOpacity
                        key={field}
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
            onPress={() => router.push('/settings' as never)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="ruler" size={20} color={textSecondary} />
            <Text style={[styles.linkText, { color: textPrimary }]}>
              {t('settings.units')}
            </Text>
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
