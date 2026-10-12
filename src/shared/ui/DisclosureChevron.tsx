import React, { useEffect } from 'react';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface DisclosureChevronProps {
  /** Whether what the control opens is open. */
  expanded: boolean;
  size: number;
  color: string;
}

/**
 * The chevron on every control that opens and closes content in place. It
 * points down while closed and turns half a circle to point up when open, so
 * every disclosure in the app reads the same way. The state itself belongs on
 * the control's `accessibilityState.expanded`: the chevron is drawn only.
 */
export function DisclosureChevron({ expanded, size, color }: DisclosureChevronProps) {
  const turn = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    turn.value = withTiming(expanded ? 1 : 0, {
      duration: 250,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
    });
  }, [expanded, turn]);

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(turn.value, [0, 1], [0, 180])}deg` }],
  }));

  return (
    <Animated.View style={style}>
      <MaterialCommunityIcons name="chevron-down" size={size} color={color} />
    </Animated.View>
  );
}
