import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/shared/app';
import { colors, darkColors } from '@/theme';
import { useTabBarClearance } from '@/shared/ui';
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
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();

  const themeColors = isDark ? darkColors : colors;
  const bg = themeColors.background;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <ManualEntryForm
        activityType={activityType}
        pairedEventId={pairedEventId}
        prefill={prefill}
        rpe={rpe}
        above={above}
        unsaved={unsaved}
        bottomPadding={insets.bottom + tabBarClearance}
      />
    </View>
  );
}
