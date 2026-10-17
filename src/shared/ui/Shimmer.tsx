import React from 'react';
import { View, StyleSheet, ViewStyle, DimensionValue, type StyleProp } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, darkColors, duration, layout, spacing } from '@/theme';
import { useTheme } from '@/shared/app';
import { CARD_HEIGHT, CARD_MARGIN } from '@/features/activity/lib/cardLayout';
import { Card } from './Card';

interface ShimmerProps {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
  animated?: boolean;
}

function ShimmerHighlight({ color, borderRadius }: { color: string; borderRadius: number }) {
  const opacity = useSharedValue(0.3);

  React.useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: duration.pulse }),
        withTiming(0.3, { duration: duration.pulse })
      ),
      -1
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { backgroundColor: color, borderRadius }, animatedStyle]}
    />
  );
}

export function Shimmer({
  width = '100%',
  height = 20,
  borderRadius = layout.borderRadiusSm,
  style,
  animated = true,
}: ShimmerProps) {
  const { isDark } = useTheme();
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
      {animated ? <ShimmerHighlight color={highlightColor} borderRadius={borderRadius} /> : null}
    </View>
  );
}

/**
 * A skeleton reads as one busy progress element that says it is loading. Its
 * grey blocks sit in a hidden wrapper, since hiding them on the root would
 * hide the root as well, so none of them is a focus stop of its own.
 */
function SkeletonFrame({
  testID,
  style,
  children,
}: {
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <View
      testID={testID}
      style={style}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('common.loading')}
      accessibilityState={{ busy: true }}
    >
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {children}
      </View>
    </View>
  );
}

// Pre-built skeleton patterns
export function ActivityCardSkeleton() {
  return (
    <SkeletonFrame testID="activity-card-skeleton" style={styles.activityCard}>
      <Card variant="raised" padding="none">
        <View testID="activity-card-skeleton-fill" style={{ height: CARD_HEIGHT }}>
          <Shimmer width="100%" height={CARD_HEIGHT} borderRadius={0} />
        </View>
      </Card>
    </SkeletonFrame>
  );
}

export function ChartSkeleton({
  height = 200,
  animated = true,
}: {
  height?: number;
  animated?: boolean;
}) {
  return (
    <SkeletonFrame>
      <View style={styles.chartHeader}>
        <Shimmer width={140} height={20} borderRadius={layout.borderRadiusXs} animated={animated} />
        <Shimmer width={80} height={16} borderRadius={layout.borderRadiusXs} animated={animated} />
      </View>
      <Shimmer
        width="100%"
        height={height}
        borderRadius={layout.borderRadius}
        style={{ marginTop: spacing.smPlus }}
        animated={animated}
      />
    </SkeletonFrame>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  activityCard: {
    marginHorizontal: CARD_MARGIN,
    marginBottom: CARD_MARGIN,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
