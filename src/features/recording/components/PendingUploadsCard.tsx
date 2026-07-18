import React, { useState, useCallback } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { navigateTo } from '@/shared/app/navigation';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, layout, colorWithOpacity } from '@/theme';
import { getUnuploadedCount } from '@/features/recording/lib/storage/recordingLibrary';

/** Home banner shown while locally saved recordings are not yet on intervals.icu. */
function PendingUploadsCardInner() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getUnuploadedCount().then((n) => {
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
    <TouchableOpacity
      testID="pending-uploads-card"
      style={[styles.card, { backgroundColor: colorWithOpacity(tint, 0.1) }]}
      onPress={() => navigateTo('/recordings')}
      activeOpacity={0.7}
      accessibilityRole="button"
    >
      <MaterialCommunityIcons name="cloud-upload-outline" size={18} color={tint} />
      <Text style={[styles.text, { color: tint }]} numberOfLines={1}>
        {t('recording.library.pendingUploads', '{{count}} recording(s) not uploaded yet', {
          count,
        })}
      </Text>
      <MaterialCommunityIcons name="chevron-right" size={18} color={tint} />
    </TouchableOpacity>
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
    fontSize: 13,
    fontWeight: '600',
  },
});
