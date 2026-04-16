import React from 'react';
import { View, Modal, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { darkColors, spacing, layout, typography, brand } from '@/theme';
import { getActivityIcon, getActivityColor } from '@/lib/utils/activityUtils';
import type { ActivityType } from '@/types';

// Common activity types for the selector, ordered by popularity
const ACTIVITY_TYPE_OPTIONS: ActivityType[] = [
  'Ride',
  'Run',
  'VirtualRide',
  'Walk',
  'Hike',
  'Swim',
  'MountainBikeRide',
  'GravelRide',
  'TrailRun',
  'WeightTraining',
  'Yoga',
  'Rowing',
  'NordicSki',
  'AlpineSki',
  'Workout',
  'EBikeRide',
  'OpenWaterSwim',
  'Treadmill',
  'VirtualRun',
  'Other',
];

interface ActivityTypePickerModalProps {
  visible: boolean;
  selectedType: ActivityType;
  onSelect: (type: ActivityType) => void;
  onClose: () => void;
}

function ActivityTypePickerModalInner({
  visible,
  selectedType,
  onSelect,
  onClose,
}: ActivityTypePickerModalProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const textPrimary = isDark ? darkColors.textPrimary : '#1A1A1A';
  const textSecondary = isDark ? darkColors.textSecondary : '#666666';

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.modalContent,
            { backgroundColor: isDark ? darkColors.surface : '#FFFFFF' },
          ]}
        >
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: textPrimary }]}>
              {t('recording.activityType', 'Activity Type')}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <MaterialCommunityIcons name="close" size={24} color={textSecondary} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={ACTIVITY_TYPE_OPTIONS}
            keyExtractor={(item) => item}
            renderItem={({ item }) => {
              const isSelected = item === selectedType;
              const itemColor = getActivityColor(item);
              return (
                <TouchableOpacity
                  style={[
                    styles.typeOption,
                    isSelected && {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
                    },
                  ]}
                  onPress={() => onSelect(item)}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons
                    name={getActivityIcon(item)}
                    size={22}
                    color={itemColor}
                  />
                  <Text style={[styles.typeOptionText, { color: textPrimary }]}>
                    {t(`activityTypes.${item}`, item)}
                  </Text>
                  {isSelected && (
                    <MaterialCommunityIcons name="check" size={20} color={brand.teal} />
                  )}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

export const ActivityTypePickerModal = React.memo(ActivityTypePickerModalInner);

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    maxHeight: '60%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 34,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128, 128, 128, 0.2)',
  },
  modalTitle: {
    ...typography.sectionTitle,
  },
  typeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    minHeight: layout.minTapTarget,
  },
  typeOptionText: {
    ...typography.body,
    flex: 1,
  },
});
