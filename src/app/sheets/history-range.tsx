import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { goBack } from '@/shared/app/navigation';
import { SheetHeader } from '@/shared/ui';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { SyncRangePanel } from '@/features/settings';
import { colors, darkColors, layout, spacing, typography } from '@/theme';

/**
 * The activity history sheet: the range slider, what a proposed range costs before it is
 * confirmed, and the download's progress. Every control that offers to widen the downloaded range
 * opens it in place with `openHistoryRange`.
 */
function HistoryRangeSheetContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  return (
    <View testID="history-range-sheet" style={styles.sheet}>
      <SheetHeader
        title={t('settings.activityHistory')}
        onCancel={() => goBack()}
        cancelTestID="history-range-cancel"
      />
      <Text
        style={[styles.intro, { color: isDark ? darkColors.textSecondary : colors.textSecondary }]}
      >
        {t('settings.activityHistoryIntro')}
      </Text>
      <SyncRangePanel />
    </View>
  );
}

export default withScreenBoundary(HistoryRangeSheetContent, 'History range');

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    paddingBottom: layout.screenPadding,
  },
  intro: {
    ...typography.caption,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
});
