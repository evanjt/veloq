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
import { useTheme } from '@/hooks';

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
    <View style={[styles.activityCard, isDark && styles.cardDark]}>
      <Shimmer width="100%" height={252} borderRadius={0} />
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
        style={{ marginTop: spacing.sm + spacing.xs }}
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
        style={{ marginLeft: spacing.xs + 2 }}
      />
      <Shimmer
        width={75}
        height={44}
        borderRadius={layout.borderRadius}
        style={{ marginLeft: spacing.xs + 2 }}
      />
    </View>
  );
}

export function WellnessCardSkeleton() {
  const { isDark } = useTheme();

  return (
    <View style={[styles.wellnessCard, isDark && styles.cardDark]}>
      <Shimmer width={120} height={18} borderRadius={layout.borderRadiusXs} />
      <View style={styles.wellnessGrid}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.wellnessItem}>
            <Shimmer width={40} height={40} borderRadius={layout.borderRadiusSm} />
            <Shimmer
              width={60}
              height={14}
              borderRadius={layout.borderRadiusXs}
              style={{ marginTop: spacing.sm }}
            />
          </View>
        ))}
      </View>
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
    marginHorizontal: layout.cardMargin,
    marginBottom: layout.cardMargin,
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
  wellnessGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.md,
  },
  wellnessItem: {
    alignItems: 'center',
  },
  wellnessCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    marginBottom: layout.cardMargin,
  },
});
