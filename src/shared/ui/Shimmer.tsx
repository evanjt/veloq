import React from 'react';
import { View, StyleSheet, ViewStyle, DimensionValue } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, darkColors, layout, spacing } from '@/theme';
import { useTheme } from '@/shared/app';
import { CARD_HEIGHT, CARD_MARGIN } from '@/features/activity/lib/cardLayout';

interface ShimmerProps {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Shimmer({
  width = '100%',
  height = 20,
  borderRadius = layout.borderRadiusSm,
  style,
}: ShimmerProps) {
  const { isDark } = useTheme();
  const opacity = useSharedValue(0.3);

  React.useEffect(() => {
    opacity.value = withRepeat(
      withSequence(withTiming(0.7, { duration: 800 }), withTiming(0.3, { duration: 800 })),
      -1
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const baseColor = isDark ? darkColors.surface : colors.border;
  const highlightColor = isDark ? darkColors.border : colors.divider;

  return (
    <View
      style={[
        styles.container,
        {
          width,
          height,
          borderRadius,
          backgroundColor: baseColor,
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: highlightColor,
            borderRadius,
          },
          animatedStyle,
        ]}
      />
    </View>
  );
}

// Pre-built skeleton patterns
export function ActivityCardSkeleton() {
  const { isDark } = useTheme();

  return (
    <View testID="activity-card-skeleton" style={[styles.activityCard, isDark && styles.cardDark]}>
      <View testID="activity-card-skeleton-fill" style={{ height: CARD_HEIGHT }}>
        <Shimmer width="100%" height={CARD_HEIGHT} borderRadius={0} />
      </View>
    </View>
  );
}

export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <View>
      <View style={styles.chartHeader}>
        <Shimmer width={140} height={20} borderRadius={layout.borderRadiusXs} />
        <Shimmer width={80} height={16} borderRadius={layout.borderRadiusXs} />
      </View>
      <Shimmer
        width="100%"
        height={height}
        borderRadius={layout.borderRadius}
        style={{ marginTop: spacing.smPlus }}
      />
    </View>
  );
}

export function StatsPillSkeleton() {
  return (
    <View style={styles.pillRow}>
      <Shimmer width={80} height={44} borderRadius={layout.borderRadius} />
      <Shimmer
        width={70}
        height={44}
        borderRadius={layout.borderRadius}
        style={{ marginLeft: spacing.xsPlus }}
      />
      <Shimmer
        width={75}
        height={44}
        borderRadius={layout.borderRadius}
        style={{ marginLeft: spacing.xsPlus }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  activityCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    marginHorizontal: CARD_MARGIN,
    marginBottom: CARD_MARGIN,
    overflow: 'hidden',
  },
  cardDark: {
    backgroundColor: darkColors.surface,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pillRow: {
    flexDirection: 'row',
  },
});
