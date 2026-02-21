import React from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';

interface CompassArrowProps {
  /** Size of the compass arrow */
  size?: number;
  /** Rotation as Animated.Value (degrees, 0 = north up) */
  rotation: Animated.Value;
  /** Color for north (top) half */
  northColor?: string;
  /** Color for south (bottom) half */
  southColor?: string;
}

/**
 * A bicolor compass arrow - red pointing north, white pointing south.
 * Rotates based on map bearing to always show true north.
 * Uses Animated.Value for smooth rotation without re-renders.
 */
export function CompassArrow({
  size = 22,
  rotation,
  northColor = '#E53935',
  southColor = '#FFFFFF',
}: CompassArrowProps) {
  const rotateInterpolation = rotation.interpolate({
    inputRange: [-360, 360],
    outputRange: ['-360deg', '360deg'],
  });

  return (
    <Animated.View style={[styles.container, { transform: [{ rotate: rotateInterpolation }] }]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {/* North (top) triangle - red */}
        <Path d="M12 2 L16 12 L12 10 L8 12 Z" fill={northColor} />
        {/* South (bottom) triangle - white */}
        <Path d="M12 22 L8 12 L12 14 L16 12 Z" fill={southColor} />
      </Svg>
    </Animated.View>
  );
}

interface StaticCompassArrowProps {
  /** Size of the compass arrow (default 16) */
  size?: number;
  /** Map bearing in degrees — arrow rotates to point north */
  bearing: number;
  /** Color for north (top) half */
  northColor?: string;
  /** Color for south (bottom) half */
  southColor?: string;
}

/**
 * Static (non-animated) compass arrow for overlaying on terrain previews.
 * Takes a plain bearing number instead of Animated.Value.
 */
export function StaticCompassArrow({
  size = 16,
  bearing,
  northColor = '#E53935',
  southColor = '#FFFFFF',
}: StaticCompassArrowProps) {
  return (
    <View style={[styles.staticContainer, { transform: [{ rotate: `${-bearing}deg` }] }]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M12 2 L16 12 L12 10 L8 12 Z" fill={northColor} />
        <Path d="M12 22 L8 12 L12 14 L16 12 Z" fill={southColor} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  staticContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
