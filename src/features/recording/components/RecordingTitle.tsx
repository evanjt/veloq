/**
 * The recording detail screen's header title. The name lives in the library
 * entry, which only the screen's own id knows, so the header reads it rather
 * than the screen drawing a title row of its own.
 */

import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { View } from 'react-native';

import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, typography } from '@/theme';
import { getRecording } from '@/features/recording/lib/storage/recordingLibrary';
import { getActivityIcon, getActivityColor } from '@/features/activity';
import type { RecordingLibraryEntry } from '@/types';

export function RecordingTitle() {
  const { isDark } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [entry, setEntry] = useState<RecordingLibraryEntry | null>(null);

  useEffect(() => {
    let live = true;
    if (id) {
      getRecording(id).then((found) => {
        if (live) setEntry(found);
      });
    }
    return () => {
      live = false;
    };
  }, [id]);

  if (!entry) return null;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
      <MaterialCommunityIcons
        name={getActivityIcon(entry.activityType)}
        size={22}
        color={getActivityColor(entry.activityType)}
      />
      <Text
        numberOfLines={1}
        style={{
          fontSize: typography.cardTitle.fontSize,
          color: isDark ? darkColors.textPrimary : colors.textPrimary,
        }}
      >
        {entry.name}
      </Text>
    </View>
  );
}
