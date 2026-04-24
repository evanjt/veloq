import React, { useMemo } from 'react';
import { View, Modal, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, layout, typography, brand } from '@/theme';
import { getActivityIcon, getActivityColor } from '@/lib/utils/activityUtils';
import { ACTIVITY_CATEGORIES } from '@/lib/utils/recordingModes';
import type { ActivityType } from '@/types';

/**
 * Shared activity-type picker modal for the review screen and the recording
 * screen. The `mode` prop switches the two call sites' differences:
 *
 * - `review` (default): shows a curated 20-type popular set, passive backdrop,
 *   no per-item border, neutral selected-row highlight. Used when reviewing a
 *   completed or manual activity.
 * - `recording`: shows all activity types from `ACTIVITY_CATEGORIES`, dismisses
 *   on backdrop tap, hairline border per row, teal-tinted selected row. Used
 *   for changing sport mid-recording.
 *
 * The recording screen can pass `isDark` as a prop to avoid re-running
 * `useTheme()` inside the active-recording render tree. If `isDark` is
 * undefined the component falls back to the theme hook.
 */

// Curated set shown on the review screen — ordered by popularity.
const REVIEW_ACTIVITY_TYPES: ActivityType[] = [
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

function flattenCategories(): ActivityType[] {
  const types: ActivityType[] = [];
  for (const group of Object.values(ACTIVITY_CATEGORIES)) {
    for (const type of group) {
      types.push(type as ActivityType);
    }
  }
  return types;
}

export interface ActivityTypePickerModalProps {
  visible: boolean;
  selectedType: ActivityType;
  onSelect: (type: ActivityType) => void;
  onClose: () => void;
  /** Which styling + data source variant to render. Defaults to 'review'. */
  mode?: 'review' | 'recording';
  /** Optional theme override. When omitted, `useTheme()` is called internally. */
  isDark?: boolean;
}

function ActivityTypePickerModalInner({
  visible,
  selectedType,
  onSelect,
  onClose,
  mode = 'review',
  isDark: isDarkProp,
}: ActivityTypePickerModalProps) {
  const { t } = useTranslation();
  const { isDark: isDarkHook } = useTheme();
  const isDark = isDarkProp ?? isDarkHook;

  const isRecording = mode === 'recording';
  const types = useMemo(
    () => (isRecording ? flattenCategories() : REVIEW_ACTIVITY_TYPES),
    [isRecording]
  );

  const surface = isDark ? darkColors.surface : colors.surface;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const border = isDark ? darkColors.border : colors.border;

  const selectedRowStyle = isRecording
    ? styles.rowSelectedRecording
    : {
        backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
      };

  const titleKey = isRecording ? 'recording.changeType' : 'recording.activityType';
  const titleFallback = isRecording ? 'Change Activity Type' : 'Activity Type';

  const BackdropTouchable = isRecording ? TouchableOpacity : View;
  const backdropTouchableProps = isRecording ? { activeOpacity: 1, onPress: onClose } : {};

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={isRecording ? onClose : undefined}
    >
      <BackdropTouchable style={styles.backdrop} {...backdropTouchableProps}>
        <View
          style={[styles.sheet, isRecording && styles.sheetRecording, { backgroundColor: surface }]}
        >
          <View style={[styles.header, !isRecording && styles.headerBordered]}>
            <Text style={[styles.title, { color: textPrimary }]}>{t(titleKey, titleFallback)}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialCommunityIcons
                name="close"
                size={isRecording ? 22 : 24}
                color={textSecondary}
              />
            </TouchableOpacity>
          </View>
          <FlatList
            data={types}
            keyExtractor={(item) => item}
            style={isRecording ? styles.list : undefined}
            renderItem={({ item }) => {
              const isSelected = item === selectedType;
              return (
                <TouchableOpacity
                  style={[
                    styles.row,
                    isRecording && { borderBottomColor: border, ...styles.rowBordered },
                    isSelected && selectedRowStyle,
                  ]}
                  onPress={() => onSelect(item)}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons
                    name={getActivityIcon(item)}
                    size={22}
                    color={getActivityColor(item)}
                    style={isRecording ? styles.iconRecording : undefined}
                  />
                  <Text style={[styles.label, { color: textPrimary }]}>
                    {t(`activityTypes.${item}`, item)}
                  </Text>
                  {isSelected && (
                    <MaterialCommunityIcons
                      name="check"
                      size={isRecording ? 18 : 20}
                      color={brand.teal}
                    />
                  )}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </BackdropTouchable>
    </Modal>
  );
}

export const ActivityTypePickerModal = React.memo(ActivityTypePickerModalInner);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    maxHeight: '60%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 34,
  },
  sheetRecording: {
    borderTopLeftRadius: layout.borderRadius,
    borderTopRightRadius: layout.borderRadius,
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  headerBordered: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128, 128, 128, 0.2)',
  },
  title: {
    ...typography.sectionTitle,
  },
  list: {
    paddingHorizontal: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    minHeight: layout.minTapTarget,
  },
  rowBordered: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
  },
  rowSelectedRecording: {
    backgroundColor: 'rgba(20, 184, 166, 0.08)',
  },
  iconRecording: {
    marginRight: spacing.sm,
    width: 28,
    textAlign: 'center',
  },
  label: {
    ...typography.body,
    flex: 1,
  },
});
