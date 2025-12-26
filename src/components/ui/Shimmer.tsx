import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, useColorScheme, ViewStyle, DimensionValue } from 'react-native';
import { colors, darkColors, opacity } from '@/theme/colors';
import { layout, spacing } from '@/theme/spacing';

interface ShimmerProps {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Shimmer({
  width = '100%',
  height = 20,
  borderRadius = 8,
  style,
}: ShimmerProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const animatedValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [animatedValue]);

  const opacity = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  // Use theme-aware shimmer colors
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
            opacity,
            borderRadius,
          },
        ]}
      />
    </View>
  );
}

// Pre-built skeleton patterns
export function ActivityCardSkeleton() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <View style={[styles.card, isDark && styles.cardDark]}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <Shimmer width={40} height={40} borderRadius={20} />
        <View style={styles.headerText}>
          <Shimmer width={180} height={18} borderRadius={4} />
          <Shimmer width={120} height={14} borderRadius={4} style={{ marginTop: 6 }} />
        </View>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Shimmer width={50} height={24} borderRadius={4} />
          <Shimmer width={40} height={12} borderRadius={4} style={{ marginTop: 4 }} />
        </View>
        <View style={styles.stat}>
          <Shimmer width={50} height={24} borderRadius={4} />
          <Shimmer width={40} height={12} borderRadius={4} style={{ marginTop: 4 }} />
        </View>
        <View style={styles.stat}>
          <Shimmer width={50} height={24} borderRadius={4} />
          <Shimmer width={40} height={12} borderRadius={4} style={{ marginTop: 4 }} />
        </View>
      </View>

      {/* Map placeholder */}
      <Shimmer width="100%" height={120} borderRadius={8} style={{ marginTop: 12 }} />
    </View>
  );
}

export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <View>
      <View style={styles.chartHeader}>
        <Shimmer width={140} height={20} borderRadius={4} />
        <Shimmer width={80} height={16} borderRadius={4} />
      </View>
      <Shimmer width="100%" height={height} borderRadius={12} style={{ marginTop: 12 }} />
    </View>
  );
}

export function StatsPillSkeleton() {
  return (
    <View style={styles.pillRow}>
      <Shimmer width={80} height={44} borderRadius={14} />
      <Shimmer width={70} height={44} borderRadius={14} style={{ marginLeft: 6 }} />
      <Shimmer width={75} height={44} borderRadius={14} style={{ marginLeft: 6 }} />
    </View>
  );
}

export function WellnessCardSkeleton() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <View style={[styles.card, isDark && styles.cardDark]}>
      <Shimmer width={120} height={18} borderRadius={4} />
      <View style={styles.wellnessGrid}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.wellnessItem}>
            <Shimmer width={40} height={40} borderRadius={8} />
            <Shimmer width={60} height={14} borderRadius={4} style={{ marginTop: 8 }} />
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    marginBottom: layout.cardMargin,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerText: {
    marginLeft: layout.cardMargin,
    flex: 1,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.md,
    paddingTop: layout.cardMargin,
    borderTopWidth: 1,
    borderTopColor: opacity.overlay.light,
  },
  stat: {
    alignItems: 'center',
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
});
