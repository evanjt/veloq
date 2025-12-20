import React, { useMemo } from 'react';
import { View, StyleSheet, useColorScheme, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
// TODO: Victory Native v41+ uses new Skia-based API - needs rewrite
// import { VictoryArea, VictoryChart, VictoryAxis } from 'victory-native';
import { colors, spacing, typography } from '@/theme';

interface ElevationChartProps {
  altitude?: number[];
  distance?: number[];
  height?: number;
}

export function ElevationChart({
  altitude = [],
  distance = [],
  height = 150,
}: ElevationChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const screenWidth = Dimensions.get('window').width - 32;

  const data = useMemo(() => {
    if (altitude.length === 0) return [];

    // Sample data if too many points
    const maxPoints = 100;
    const step = Math.max(1, Math.floor(altitude.length / maxPoints));

    const points = [];
    for (let i = 0; i < altitude.length; i += step) {
      points.push({
        x: distance.length > i ? distance[i] / 1000 : i * 0.01, // Convert to km
        y: altitude[i],
      });
    }
    return points;
  }, [altitude, distance]);

  const { minAlt, maxAlt, totalDistance } = useMemo(() => {
    if (data.length === 0) {
      return { minAlt: 0, maxAlt: 100, totalDistance: 0 };
    }
    const altitudes = data.map((d) => d.y);
    const min = Math.min(...altitudes);
    const max = Math.max(...altitudes);
    const padding = (max - min) * 0.1 || 10;
    return {
      minAlt: Math.floor(min - padding),
      maxAlt: Math.ceil(max + padding),
      totalDistance: data[data.length - 1]?.x || 0,
    };
  }, [data]);

  if (data.length === 0) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={styles.placeholderText}>No elevation data</Text>
      </View>
    );
  }

  // TODO: Rewrite with Victory Native v41+ Skia API (CartesianChart, Area, etc.)
  // For now, show a simple text summary
  return (
    <View style={[styles.placeholder, { height }]}>
      <Text style={[styles.placeholderText, isDark && { color: '#AAA' }]}>
        Elevation: {Math.round(minAlt)}m - {Math.round(maxAlt)}m
      </Text>
      <Text style={[styles.placeholderText, isDark && { color: '#AAA' }]}>
        (Chart coming soon)
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: spacing.sm,
  },
  placeholder: {
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  placeholderText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
