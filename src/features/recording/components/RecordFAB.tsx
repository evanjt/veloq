import React from 'react';
import { StyleSheet, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from 'expo-router';

import { navigateTo } from '@/shared/app/navigation';
import { useBottomClearance } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { useFootCover } from '@/shared/ui/bottomPills';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { useTheme } from '@/shared/app';
import { colors, floatingLayers, iconSize, layout, raised, recording, spacing } from '@/theme';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

const FAB_OFFSET = spacing.md;
const FAB_COVER = FAB_OFFSET + layout.recordFabSize;

/** Floating action button that opens the record screen. Hidden while a session is active. */
function RecordFABInner() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  // Floats absolute, so a safe area around it does not lift it by its padding.
  const bottomClearance = useBottomClearance({ insetTaken: false });
  const sessionActive = useRecordingStore((s) => s.status === 'recording' || s.status === 'paused');
  const focused = useIsFocused();
  // The bottom pills stack above the button while it shows on the screen in front.
  useFootCover('recordFab', focused && !sessionActive ? FAB_COVER : null);

  if (sessionActive) return null;

  return (
    <Pressable
      testID="record-fab"
      style={pressable([
        styles.fab,
        raised('fab', isDark),
        {
          bottom: bottomClearance + FAB_OFFSET,
          backgroundColor: isDark ? recording.dark : recording.light,
        },
      ])}
      android_ripple={pressRipple}
      onPress={() => navigateTo('/record')}
      accessibilityRole="button"
      accessibilityLabel={t('recording.startActivity', 'Start activity')}
    >
      <Icon name="record-circle-outline" size={iconSize.xl} color={colors.textOnFill} />
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
    zIndex: floatingLayers.recordButton,
    minWidth: layout.minTapTarget,
    minHeight: layout.minTapTarget,
  },
});
