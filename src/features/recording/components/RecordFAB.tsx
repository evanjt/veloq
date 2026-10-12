import React from 'react';
import { StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { tapTo } from '@/shared/app/navigation';
import { useBottomClearance } from '@/shared/ui';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { useTheme } from '@/shared/app';
import { colors, recording, spacing, layout } from '@/theme';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

/** Floating action button that opens the record screen. Hidden while a session is active. */
function RecordFABInner() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  // Floats absolute, so a safe area around it does not lift it by its padding.
  const bottomClearance = useBottomClearance({ insetTaken: false });
  const sessionActive = useRecordingStore((s) => s.status === 'recording' || s.status === 'paused');

  if (sessionActive) return null;

  return (
    <Pressable
      testID="record-fab"
      style={pressable([
        styles.fab,
        {
          bottom: bottomClearance + spacing.md,
          backgroundColor: isDark ? recording.dark : recording.light,
        },
      ])}
      android_ripple={pressRipple}
      onPress={() => tapTo('/record')}
      accessibilityRole="button"
      accessibilityLabel={t('recording.startActivity', 'Start Activity')}
    >
      <MaterialCommunityIcons name="record-circle-outline" size={28} color={colors.textOnDark} />
    </Pressable>
  );
}

export const RecordFAB = React.memo(RecordFABInner);

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: spacing.md,
    width: layout.recordFabSize,
    height: layout.recordFabSize,
    borderRadius: layout.borderRadiusFull,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: colors.shadowBlack,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    zIndex: 10,
    minWidth: layout.minTapTarget,
    minHeight: layout.minTapTarget,
  },
});
