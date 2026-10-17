import React, { useState, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { tapTo } from '@/shared/app/navigation';
import { Card } from '@/shared/ui/Card';
import { useTheme } from '@/shared/app';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
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
  const label = t('recording.library.pendingUploads', { count });

  return (
    <Card
      variant="flat"
      padding="sm"
      testID="pending-uploads-card"
      onPress={() => tapTo('/recordings')}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.row}
    >
      <MaterialCommunityIcons name="cloud-upload-outline" size={iconSize.sm} color={tint} />
      <Text style={[styles.text, { color: tint }]}>{label}</Text>
      <MaterialCommunityIcons name="chevron-right" size={iconSize.sm} color={tint} />
    </Card>
  );
}

export const PendingUploadsCard = React.memo(PendingUploadsCardInner);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  text: {
    ...typography.bodyCompactBold,
    flex: 1,
  },
});
