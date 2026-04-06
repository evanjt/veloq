/**
 * Floating circular target for the map-tab swipe-to-record gesture.
 * Appears ~80px above the map tab icon when long-press activates.
 * Red dot (from BottomTabBar) follows finger toward this target ring.
 * When the drag enters the target zone, it highlights and triggers recording.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  interpolate,
  withRepeat,
  withTiming,
  useSharedValue,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TAB_BAR_HEIGHT, GRADIENT_HEIGHT } from '@/components/ui/BottomTabBar';
import { useEffect } from 'react';

const TARGET_SIZE = 44;
const TARGET_OFFSET_Y = 80;

interface RecordSwipeTargetProps {
  visible: SharedValue<number>;
  dragY: SharedValue<number>;
  isActivated: SharedValue<boolean>;
}

export function RecordSwipeTarget({ visible, dragY, isActivated }: RecordSwipeTargetProps) {
  const insets = useSafeAreaInsets();
  const tabBarTotalHeight = TAB_BAR_HEIGHT + GRADIENT_HEIGHT + insets.bottom;
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1.15, { duration: 1000 }), -1, true);
  }, [pulse]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(visible.value, [0, 1], [0, 1]),
    pointerEvents: visible.value > 0.5 ? ('auto' as const) : ('none' as const),
  }));

  const ringStyle = useAnimatedStyle(() => {
    const active = isActivated.value;
    const scale = active ? 1.2 : pulse.value;
    return {
      transform: [{ scale }],
      backgroundColor: active ? 'rgba(255, 255, 255, 0.25)' : 'transparent',
      borderColor: active ? '#FFFFFF' : 'rgba(255, 255, 255, 0.6)',
    };
  });

  const dotStyle = useAnimatedStyle(() => {
    const clampedDrag = Math.min(0, dragY.value);
    const translateY = interpolate(
      clampedDrag,
      [0, -TARGET_OFFSET_Y],
      [0, -TARGET_OFFSET_Y],
      Extrapolation.CLAMP
    );
    const scale = isActivated.value ? 1.3 : 1;
    return {
      transform: [{ translateY }, { scale }],
    };
  });

  return (
    <Animated.View
      style={[
        styles.container,
        { bottom: tabBarTotalHeight + TARGET_OFFSET_Y - TARGET_SIZE / 2 },
        containerStyle,
      ]}
    >
      {/* Target ring */}
      <Animated.View style={[styles.targetRing, ringStyle]}>
        <MaterialCommunityIcons
          name="record-circle-outline"
          size={20}
          color="rgba(255, 255, 255, 0.8)"
        />
      </Animated.View>

      {/* Red dot that follows finger */}
      <Animated.View
        style={[
          styles.redDot,
          { bottom: -(TARGET_OFFSET_Y - TARGET_SIZE / 2 + TAB_BAR_HEIGHT / 2) },
          dotStyle,
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1001,
    height: TARGET_SIZE,
  },
  targetRing: {
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  redDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#EF4444',
  },
});
