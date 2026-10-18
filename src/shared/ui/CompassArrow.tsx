import React from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '@/shared/app';
import { colors, darkColors, iconSize } from '@/theme';

interface CompassArrowProps {
  /** Size of the compass arrow */
  size?: number;
  /** Rotation as Animated.Value (degrees, 0 = north up) */
  rotation: Animated.Value;
}

/**
 * The north half in the compass role and the south half in the secondary icon
 * ink, read from the app theme. Every compass draws these two, so no caller
 * picks a colour.
 */
function useCompassColours(): { north: string; south: string } {
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  return { north: palette.compassNorth, south: palette.iconSecondary };
}

/**
 * A two-colour compass arrow that rotates with the map bearing to keep
 * pointing at true north. Uses Animated.Value for smooth rotation without
 * re-renders.
 */
export function CompassArrow({ size = iconSize.lg, rotation }: CompassArrowProps) {
  const { north: northColor, south: southColor } = useCompassColours();
  const rotateInterpolation = rotation.interpolate({
    inputRange: [-360, 360],
    outputRange: ['-360deg', '360deg'],
  });

  return (
    <Animated.View style={[styles.container, { transform: [{ rotate: rotateInterpolation }] }]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {/* North (top) triangle */}
        <Path d="M12 2 L16 12 L12 10 L8 12 Z" fill={northColor} />
        {/* South (bottom) triangle */}
        <Path d="M12 22 L8 12 L12 14 L16 12 Z" fill={southColor} />
      </Svg>
    </Animated.View>
  );
}

interface StaticCompassArrowProps {
  /** Size of the compass arrow */
  size?: number;
  /** Map bearing in degrees - arrow rotates to point north */
  bearing: number;
}

/**
 * Static (non-animated) compass arrow for overlaying on terrain previews.
 * Takes a plain bearing number instead of Animated.Value.
 *
 * Drawn from border triangles rather than an SVG: a feed row carries one, and an
 * SVG surface re-renders and dispatches a layout event every time the list
 * reattaches the row, inside the draw pass of a scroll frame.
 */
export function StaticCompassArrow({ size = iconSize.sm, bearing }: StaticCompassArrowProps) {
  const { north: northColor, south: southColor } = useCompassColours();
  // The same 24-unit arrow as the SVG one: each half 8 wide and 10 tall.
  const halfWidth = (size * 4) / 24;
  const halfHeight = (size * 10) / 24;
  const sides = {
    borderLeftWidth: halfWidth,
    borderRightWidth: halfWidth,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  };
  return (
    <View
      style={[
        styles.staticContainer,
        { width: size, height: size, transform: [{ rotate: `${-bearing}deg` }] },
      ]}
    >
      <View
        style={[
          styles.triangle,
          sides,
          { borderBottomWidth: halfHeight, borderBottomColor: northColor },
        ]}
      />
      <View
        style={[styles.triangle, sides, { borderTopWidth: halfHeight, borderTopColor: southColor }]}
      />
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
  triangle: {
    width: 0,
    height: 0,
  },
});
