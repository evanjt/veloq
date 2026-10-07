import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Shimmer } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { colors, darkColors, layout, spacing, shadows } from '@/theme';
import {
  ROW_BORDER_RADIUS,
  ROW_MARGIN_BOTTOM,
  ROW_MARGIN_HORIZONTAL,
  ROW_PADDING,
  ROW_PREVIEW_GAP,
  ROW_PREVIEW_HEIGHT,
  ROW_PREVIEW_WIDTH,
} from '@/features/routes/lib/rowLayout';

/** Placeholder for a routes or sections row, the same size as the row it becomes. */
export function RowSkeleton() {
  const { isDark } = useTheme();
  return (
    <View testID="row-skeleton" style={[styles.container, isDark && styles.containerDark]}>
      <View testID="row-skeleton-preview" style={styles.preview}>
        <Shimmer
          width={ROW_PREVIEW_WIDTH}
          height={ROW_PREVIEW_HEIGHT}
          borderRadius={layout.borderRadiusXs}
        />
      </View>
      <View style={styles.text}>
        <Shimmer width="60%" height={14} borderRadius={layout.borderRadiusXs} />
        <Shimmer width="40%" height={12} borderRadius={layout.borderRadiusXs} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: ROW_MARGIN_HORIZONTAL,
    marginBottom: ROW_MARGIN_BOTTOM,
    borderRadius: ROW_BORDER_RADIUS,
    padding: ROW_PADDING,
    ...shadows.pill,
  },
  containerDark: {
    backgroundColor: darkColors.surface,
  },
  preview: {
    width: ROW_PREVIEW_WIDTH,
    height: ROW_PREVIEW_HEIGHT,
  },
  text: {
    flex: 1,
    marginLeft: ROW_PREVIEW_GAP,
    gap: spacing.xs,
  },
});
