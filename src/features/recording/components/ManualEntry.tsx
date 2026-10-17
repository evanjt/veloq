import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing } from '@/theme';
import type { ActivityType } from '@/types';
import { ManualEntryForm, type ManualPrefill } from './ManualEntryForm';
import { styles } from '../RecordingScreen.styles';

export function ManualEntry({
  activityType,
  pairedEventId,
  prefill,
  rpe,
  above,
  unsaved,
}: {
  activityType: ActivityType;
  pairedEventId?: number | undefined;
  prefill?: ManualPrefill | undefined;
  rpe?: number | null | undefined;
  above?: ReactNode;
  unsaved?: boolean | undefined;
}) {
  const { isDark } = useTheme();

  const themeColors = isDark ? darkColors : colors;
  const bg = themeColors.surfacePage;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <ManualEntryForm
        activityType={activityType}
        pairedEventId={pairedEventId}
        prefill={prefill}
        rpe={rpe}
        above={above}
        unsaved={unsaved}
        // The form's scroll view clears the system inset itself; Save keeps this margin above it.
        bottomPadding={spacing.md}
      />
    </View>
  );
}
