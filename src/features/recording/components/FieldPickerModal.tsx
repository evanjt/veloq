/**
 * Field picker opened by long-pressing a data tile on the recording
 * screen. Selecting a field swaps it into the long-pressed slot, so the
 * grid is customisable in place without leaving the ride surface.
 */

import React from 'react';
import { View, Modal, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { brand, colors, colorWithOpacity, darkColors, spacing, layout, typography } from '@/theme';
import type { DataFieldType } from '@/types';

export const ALL_DATA_FIELDS: DataFieldType[] = [
  'speed',
  'avgSpeed',
  'pace',
  'avgPace',
  'distance',
  'heartrate',
  'power',
  'cadence',
  'elevation',
  'elevationGain',
  'calories',
  'timer',
  'movingTime',
  'lapTime',
  'lapDistance',
];

interface FieldPickerModalProps {
  visible: boolean;
  selectedField: DataFieldType | null;
  isDark: boolean;
  onSelect: (field: DataFieldType) => void;
  onClose: () => void;
}

function FieldPickerModalInner({
  visible,
  selectedField,
  isDark,
  onSelect,
  onClose,
}: FieldPickerModalProps) {
  const { t } = useTranslation();

  const surface = isDark ? darkColors.surface : colors.surface;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const border = isDark ? darkColors.border : colors.border;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <View style={[styles.sheet, { backgroundColor: surface }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: textPrimary }]}>
              {t('recording.settingsDataFields', 'Data Fields')}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <MaterialCommunityIcons name="close" size={22} color={textSecondary} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={ALL_DATA_FIELDS}
            keyExtractor={(item) => item}
            style={styles.list}
            renderItem={({ item }) => {
              const isSelected = item === selectedField;
              return (
                <TouchableOpacity
                  testID={`field-option-${item}`}
                  style={[
                    styles.row,
                    { borderBottomColor: border },
                    isSelected && styles.rowSelected,
                  ]}
                  onPress={() => onSelect(item)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[styles.rowText, { color: isSelected ? brand.teal : textPrimary }]}
                    numberOfLines={1}
                  >
                    {t(`recording.fields.${item}`)}
                  </Text>
                  {isSelected && (
                    <MaterialCommunityIcons name="check" size={18} color={brand.teal} />
                  )}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

export const FieldPickerModal = React.memo(FieldPickerModalInner);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colorWithOpacity(colors.shadowBlack, 0.4),
  },
  sheet: {
    maxHeight: '60%',
    borderTopLeftRadius: layout.borderRadius,
    borderTopRightRadius: layout.borderRadius,
    paddingBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  title: {
    ...typography.cardTitle,
  },
  list: {
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: layout.minTapTarget,
  },
  rowSelected: {
    backgroundColor: colorWithOpacity(brand.teal, 0.08),
  },
  rowText: {
    ...typography.body,
  },
});
