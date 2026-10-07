import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/shared/app';
import { colors, darkColors } from '@/theme';
import { TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import type { ActivityType } from '@/types';
import { ManualEntryHeader } from './ManualEntryHeader';
import { ManualEntryForm, type ManualPrefill } from './ManualEntryForm';
import { styles } from '../RecordingScreen.styles';

export function ManualEntry({
  activityType,
  pairedEventId,
  prefill,
  rpe,
  above,
}: {
  activityType: ActivityType;
  pairedEventId?: number | undefined;
  prefill?: ManualPrefill | undefined;
  rpe?: number | null | undefined;
  above?: ReactNode;
}) {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const themeColors = isDark ? darkColors : colors;
  const textPrimary = themeColors.textPrimary;
  const bg = themeColors.background;

  return (
    <View style={[styles.container, { backgroundColor: bg, paddingTop: insets.top }]}>
      <ManualEntryHeader activityType={activityType} textPrimary={textPrimary} />
      <ManualEntryForm
        activityType={activityType}
        pairedEventId={pairedEventId}
        prefill={prefill}
        rpe={rpe}
        above={above}
        bottomPadding={insets.bottom + TAB_BAR_SAFE_PADDING}
      />
    </View>
  );
}
