import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/shared/app';
import { colors, darkColors } from '@/theme';
import { TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import type { ActivityType } from '@/types';
import { ManualEntryHeader } from './ManualEntryHeader';
import { ManualEntryForm } from './ManualEntryForm';
import { styles } from '../RecordingScreen.styles';

export function ManualEntry({
  activityType,
  pairedEventId,
}: {
  activityType: ActivityType;
  pairedEventId?: number;
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
        bottomPadding={insets.bottom + TAB_BAR_SAFE_PADDING}
      />
    </View>
  );
}
