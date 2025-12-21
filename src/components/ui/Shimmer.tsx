import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, useColorScheme, ViewStyle } from 'react-native';

interface ShimmerProps {
  width?: number | string;
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

  const baseColor = isDark ? '#2A2A2A' : '#E0E0E0';
  const highlightColor = isDark ? '#3A3A3A' : '#F0F0F0';

  return (
    <View
      style={[
        styles.container,
        {
          width: width as any,
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
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardDark: {
    backgroundColor: '#1E1E1E',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerText: {
    marginLeft: 12,
    flex: 1,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
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
    marginTop: 16,
  },
  wellnessItem: {
    alignItems: 'center',
  },
});
