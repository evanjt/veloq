import React from 'react';
import {
  View,
  StyleSheet,
  useWindowDimensions,
  type DimensionValue,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, {
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, darkColors, duration, layout, spacing, typography } from '@/theme';
import { useTheme } from '@/shared/app';
import { CARD_HEIGHT, cardContainers } from '@/features/activity/lib/cardLayout';
import { Card } from './Card';
import { useLargeText } from './useLargeText';
import { useReduceMotion } from './reduceMotion';

interface ShimmerProps {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  animated?: boolean;
  testID?: string;
}

export function shimmerColours(isDark: boolean): { base: string; highlight: string } {
  const palette = isDark ? darkColors : colors;
  return { base: palette.fillNeutral, highlight: palette.borderStrong };
}

/**
 * One skeleton block. Its own colour pulses from the neutral fill to the strong
 * border and back, one leg per pulse duration, and holds at the fill with
 * reduce motion on.
 */
export function Shimmer({
  width = '100%',
  height = 20,
  borderRadius = layout.borderRadiusSm,
  style,
  animated = true,
  testID,
}: ShimmerProps) {
  const { isDark } = useTheme();
  const { base, highlight } = shimmerColours(isDark);
  const reduceMotion = useReduceMotion();
  const pulsing = animated && !reduceMotion;
  const progress = useSharedValue(0);

  React.useEffect(() => {
    if (pulsing) {
      progress.value = withRepeat(withTiming(1, { duration: duration.pulse }), -1, true);
    } else {
      progress.value = 0;
    }
    return () => cancelAnimation(progress);
  }, [pulsing, progress]);

  const pulse = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [base, highlight]),
  }));

  return (
    <Animated.View
      testID={testID}
      style={[
        styles.container,
        { width, height, borderRadius, backgroundColor: base },
        style,
        pulse,
      ]}
    />
  );
}

/** The height of a bar standing for a line of text, against the text's size. */
const LINE_BAR_FRACTION = 0.75;

interface SkeletonLineProps {
  /** The text style of the line it stands for: its line height and font size. */
  text: TextStyle;
  width?: DimensionValue;
  style?: StyleProp<ViewStyle>;
  animated?: boolean;
}

/**
 * A line of text still to come: a block as tall as the style's line height at
 * the system text size, holding a bar about three quarters of its font size,
 * so the line it becomes takes the same room.
 */
export function SkeletonLine({ text, width = '100%', style, animated = true }: SkeletonLineProps) {
  const { fontScale } = useWindowDimensions();
  const fontSize = text.fontSize ?? typography.body.fontSize;
  const lineHeight = text.lineHeight ?? typography.body.lineHeight;
  return (
    <View style={[styles.line, { width, height: lineHeight * fontScale }, style]}>
      <Shimmer
        width="100%"
        height={Math.round(fontSize * LINE_BAR_FRACTION * fontScale)}
        borderRadius={layout.borderRadiusXs}
        animated={animated}
      />
    </View>
  );
}

/**
 * A skeleton reads as one busy progress element that says it is loading. Its
 * grey blocks sit in a hidden wrapper, since hiding them on the root would
 * hide the root as well, so none of them is a focus stop of its own.
 */
export function SkeletonGroup({
  testID,
  style,
  contentStyle,
  label,
  children,
}: {
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** The hidden wrapper's style, for blocks laid out against the group's whole area. */
  contentStyle?: StyleProp<ViewStyle>;
  /** What it says it is waiting for; loading when not given. */
  label?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <View
      testID={testID}
      style={style}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t('common.loading')}
      accessibilityState={{ busy: true }}
    >
      <View
        style={contentStyle}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {children}
      </View>
    </View>
  );
}

/**
 * The feed's activity card while it loads, on the card's own containers: the
 * map card's fixed height, or past the dense cap the stacked card's name, map
 * and stats.
 */
export function ActivityCardSkeleton() {
  const largeText = useLargeText();
  return (
    <SkeletonGroup testID="activity-card-skeleton" style={cardContainers.wrapper}>
      <Card variant="raised" padding="none">
        {largeText ? (
          <>
            <View style={styles.flowHeader}>
              <SkeletonLine text={typography.cardTitle} width="60%" />
              <SkeletonLine text={typography.caption} width="40%" style={styles.flowSubtitle} />
            </View>
            <Shimmer width="100%" height={CARD_HEIGHT} borderRadius={0} />
            <View style={styles.flowBottom}>
              <SkeletonLine text={typography.bodyBold} width="70%" />
              <SkeletonLine text={typography.captionBold} width="50%" />
            </View>
          </>
        ) : (
          <View testID="activity-card-skeleton-fill" style={cardContainers.map}>
            <Shimmer width="100%" height={CARD_HEIGHT} borderRadius={0} />
          </View>
        )}
      </Card>
    </SkeletonGroup>
  );
}

/** A chart while it loads: its title line and value line, then the plot, or the plot alone. */
export function ChartSkeleton({
  height = 200,
  animated = true,
  header = true,
}: {
  height?: number;
  animated?: boolean;
  /** False when the chart's own card header is already drawn above it. */
  header?: boolean;
}) {
  return (
    <SkeletonGroup>
      {header ? (
        <View style={styles.chartHeader}>
          <SkeletonLine text={typography.cardTitle} width={140} animated={animated} />
          <SkeletonLine text={typography.caption} width={80} animated={animated} />
        </View>
      ) : null}
      <Shimmer
        width="100%"
        height={height}
        borderRadius={layout.borderRadius}
        style={header ? styles.chartPlot : undefined}
        animated={animated}
      />
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  line: {
    justifyContent: 'center',
  },
  flowHeader: {
    padding: spacing.smPlus,
  },
  flowSubtitle: {
    marginTop: spacing.xxs,
  },
  flowBottom: {
    padding: spacing.smPlus,
    gap: spacing.xxs,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chartPlot: {
    marginTop: spacing.smPlus,
  },
});
