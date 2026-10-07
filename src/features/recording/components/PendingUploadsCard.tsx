import React, { useState, useCallback } from 'react';
import { StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { navigateTo } from '@/shared/app/navigation';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, layout, colorWithOpacity, typography } from '@/theme';
import { getVisibleUnuploadedCount } from '@/features/recording/lib/storage/recordingLibrary';

/** Home banner shown while locally saved recordings are not yet on intervals.icu. */
function PendingUploadsCardInner() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getVisibleUnuploadedCount().then((n) => {
        if (!cancelled) setCount(n);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  if (count === 0) return null;

  const tint = isDark ? darkColors.secondary : colors.secondary;

  return (
    <Pressable
      testID="pending-uploads-card"
      style={pressable([styles.card, { backgroundColor: colorWithOpacity(tint, 0.1) }])}
      android_ripple={pressRipple}
      onPress={() => navigateTo('/recordings')}
      accessibilityRole="button"
    >
      <MaterialCommunityIcons name="cloud-upload-outline" size={18} color={tint} />
      <Text style={[styles.text, { color: tint }]} numberOfLines={1}>
        {t('recording.library.pendingUploads', '{{count}} recording(s) not uploaded yet', {
          count,
        })}
      </Text>
      <MaterialCommunityIcons name="chevron-right" size={18} color={tint} />
    </Pressable>
  );
}

export const PendingUploadsCard = React.memo(PendingUploadsCardInner);

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadius,
  },
  text: {
    flex: 1,
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
  },
});
