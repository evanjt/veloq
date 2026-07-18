import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { navigateTo } from '@/shared/app/navigation';
import { TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { brand, colors, spacing, layout } from '@/theme';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

/** Floating action button that opens the record screen. Hidden while a session is active. */
function RecordFABInner() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const sessionActive = useRecordingStore((s) => s.status === 'recording' || s.status === 'paused');

  if (sessionActive) return null;

  return (
    <TouchableOpacity
      testID="record-fab"
      style={[
        styles.fab,
        {
          bottom: insets.bottom + TAB_BAR_SAFE_PADDING + spacing.md,
          backgroundColor: isDark ? brand.tealDark : brand.tealLight,
        },
      ]}
      onPress={() => navigateTo('/record')}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={t('recording.startActivity', 'Start Activity')}
    >
      <MaterialCommunityIcons name="record-circle-outline" size={28} color={colors.textOnDark} />
    </TouchableOpacity>
  );
}

export const RecordFAB = React.memo(RecordFABInner);

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: spacing.md,
    width: 56,
    height: 56,
    borderRadius: 28,
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
