/**
 * The recording detail screen's header title. The name lives in the library
 * entry, which only the screen's own id knows, so the header reads it rather
 * than the screen drawing a title row of its own.
 */

import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { useTheme } from '@/shared/app';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import { getVisibleRecording } from '@/features/recording/lib/storage/recordingLibrary';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { sportMarkColour } from '@/shared/activity/sportCategories';
import type { RecordingLibraryEntry } from '@/types';
import { NameText } from '@/shared/ui/NameText';
import { Icon } from '@/shared/ui/Icon';

export function RecordingTitle() {
  const { isDark } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [entry, setEntry] = useState<RecordingLibraryEntry | null>(null);

  useEffect(() => {
    let live = true;
    if (id) {
      getVisibleRecording(id).then((found) => {
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
      <Icon
        name={getActivityIcon(entry.activityType)}
        size={iconSize.lg}
        color={sportMarkColour(entry.activityType, isDark)}
      />
      <NameText
        style={{
          fontSize: typography.cardTitle.fontSize,
          color: isDark ? darkColors.textPrimary : colors.textPrimary,
        }}
      >
        {entry.name}
      </NameText>
    </View>
  );
}
