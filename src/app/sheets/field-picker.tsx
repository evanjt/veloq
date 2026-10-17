import React from 'react';
import { Pressable, View, FlatList, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { pressable, pressRipple, SheetHeader } from '@/shared/ui';
import { ALL_DATA_FIELDS, CALORIES_ASSUMED_AGE, useCaloriesWeight } from '@/features/recording';
import {
  brand,
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  layout,
  spacing,
  typography,
  stroke,
} from '@/theme';
import type { DataFieldType } from '@/types';
import { tapBack } from '@/shared/app/navigation';

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
  const { input, resolve } = useSheetRequest<FieldPickerSheetInput, DataFieldType>();
  const selectedField = input?.selectedField ?? null;
  const caloriesWeight = useCaloriesWeight();

  const surface = isDark ? darkColors.surface : colors.surface;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const accentText = isDark ? darkColors.linkTeal : colors.linkTeal;
  const border = isDark ? darkColors.border : colors.border;

  return (
    <View style={[styles.sheet, { backgroundColor: surface }]}>
      <SheetHeader
        title={t('recording.settingsDataFields', 'Data Fields')}
        onCancel={() => tapBack()}
        cancelTestID="field-picker-cancel"
      />
      <FlatList
        testID="field-picker-list"
        data={ALL_DATA_FIELDS}
        keyExtractor={(item) => item}
        style={styles.list}
        initialNumToRender={ALL_DATA_FIELDS.length}
        renderItem={({ item }) => {
          const isSelected = item === selectedField;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              testID={`field-option-${item}`}
              style={pressable([
                styles.row,
                { borderBottomColor: border },
                isSelected && styles.rowSelected,
              ])}
              android_ripple={pressRipple}
              onPress={() => resolve(item)}
            >
              <View style={styles.rowLabel}>
                <Text
                  style={[styles.rowText, { color: isSelected ? accentText : textPrimary }]}
                  numberOfLines={1}
                >
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
                <MaterialCommunityIcons name="check" size={iconSize.md} color={brand.teal} />
              ) : null}
            </Pressable>
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
  rowSelected: {
    backgroundColor: colorWithOpacity(brand.teal, 0.08),
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
