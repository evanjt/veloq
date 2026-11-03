import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { Card, Row, ScreenSafeAreaView, ScreenScrollView } from '@/shared/ui';
import { ToggleButton } from '@/shared/ui/Button';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, typography } from '@/theme';
import {
  ALL_DATA_FIELDS,
  fieldsForMode,
  MAX_DATA_FIELDS,
  useRecordingPreferences,
} from '@/features/recording';
import { useSheetOpener } from '@/shared/app/sheetRequest';
import type { FieldPickerSheetInput } from '@/app/sheets/field-picker';
import type { DataFieldType } from '@/types';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

const FIELD_MODES = ['gps', 'indoor'] as const;

const MODE_LABEL_KEYS = {
  gps: 'recording.fieldModeGps',
  indoor: 'recording.fieldModeIndoor',
} as const;

function RecordingDataFieldsScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const dataFields = useRecordingPreferences((s) => s.dataFields);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.surfacePage : colors.surfacePage;

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
      testID="recording-data-fields-screen"
      style={[styles.container, { backgroundColor: bg }]}
    >
      <ScreenScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          {FIELD_MODES.map((mode) => {
            const selectedFields = fieldsForMode(dataFields, mode);
            const atCap = selectedFields.length >= MAX_DATA_FIELDS;
            return (
              <View key={mode} style={styles.modeFrame}>
                <Card variant="flat">
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
                          <Text style={[styles.linkText, { color: textPrimary }]}>
                            {fieldLabel}
                          </Text>
                        </Row>
                      );
                    })}
                  </View>
                </Card>
              </View>
            );
          })}
        </View>
      </ScreenScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingTop: spacing.sm },
  section: { paddingHorizontal: spacing.md, marginBottom: spacing.lg },
  modeFrame: { marginBottom: spacing.sm },
  rowDescription: { ...typography.caption, marginTop: spacing.xxs },
  modeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  modeLabel: { ...typography.bodyBold },
  fieldCount: { ...typography.caption },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tileOrderTitle: { ...typography.bodyBold, marginTop: spacing.md },
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
  linkText: { ...typography.body, flex: 1 },
});

export default withScreenBoundary(RecordingDataFieldsScreenContent, 'RecordingDataFields');
