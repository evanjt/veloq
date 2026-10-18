import React from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { SheetHeader, PressTarget, sheetScrollProps } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { ALL_DATA_FIELDS, CALORIES_ASSUMED_AGE, useCaloriesWeight } from '@/features/recording';
import {
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  layout,
  spacing,
  typography,
  stroke,
  themePalette,
  opacity,
} from '@/theme';
import type { DataFieldType } from '@/types';
import { goBack } from '@/shared/app/navigation';

/**
 * The data field picker for a recording tile, a sheet route opened with `openSheet` and answered
 * with the chosen `DataFieldType`.
 */

export interface FieldPickerSheetInput {
  selectedField: DataFieldType | null;
}

function FieldPickerSheetContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const { input, resolve } = useSheetRequest<FieldPickerSheetInput, DataFieldType>();
  const selectedField = input?.selectedField ?? null;
  const caloriesWeight = useCaloriesWeight();

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const accentText = isDark ? darkColors.actionLink : colors.actionLink;
  const border = isDark ? darkColors.border : colors.border;

  return (
    <View style={styles.sheet}>
      <SheetHeader
        title={t('recording.settingsDataFields', 'Data fields')}
        onCancel={() => goBack()}
        cancelTestID="field-picker-cancel"
      />
      <FlatList
        testID="field-picker-list"
        data={ALL_DATA_FIELDS}
        keyExtractor={(item) => item}
        style={styles.list}
        initialNumToRender={ALL_DATA_FIELDS.length}
        {...sheetScrollProps}
        renderItem={({ item }) => {
          const isSelected = item === selectedField;
          return (
            <PressTarget
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              testID={`field-option-${item}`}
              style={[
                styles.row,
                { borderBottomColor: border },
                isSelected && {
                  backgroundColor: colorWithOpacity(palette.actionPrimary, opacity.tint1),
                },
              ]}
              onPress={() => resolve(item)}
            >
              <View style={styles.rowLabel}>
                <Text style={[styles.rowText, { color: isSelected ? accentText : textPrimary }]}>
                  {t(`recording.fields.${item}`)}
                </Text>
                {item === 'calories' ? (
                  <Text style={[styles.rowNote, { color: textSecondary }]}>
                    {t('recording.caloriesMethod', { age: CALORIES_ASSUMED_AGE })}
                    {caloriesWeight.assumed
                      ? ` ${t('recording.caloriesDefaultWeight', { weight: caloriesWeight.weightKg })}`
                      : null}
                  </Text>
                ) : null}
              </View>
              {isSelected ? (
                <Icon name="check" size={iconSize.md} color={palette.actionPrimary} />
              ) : null}
            </PressTarget>
          );
        }}
      />
    </View>
  );
}

export default withScreenBoundary(FieldPickerSheetContent, 'Field picker');

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    paddingBottom: spacing.lg,
  },
  list: {
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: stroke.hairline,
    minHeight: layout.minTapTarget,
  },
  rowLabel: {
    flex: 1,
    paddingVertical: spacing.xs,
  },
  rowText: {
    ...typography.body,
  },
  rowNote: {
    ...typography.caption,
  },
});
