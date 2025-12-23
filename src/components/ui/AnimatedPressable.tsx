import React, { useCallback } from 'react';
import { GestureResponderEvent, Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  WithSpringConfig,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

const AnimatedPressableComponent = Animated.createAnimatedComponent(Pressable);

interface AnimatedPressableProps extends Omit<PressableProps, 'style'> {
  /** The scale to animate to when pressed (default: 0.97) */
  pressScale?: number;
  /** Whether to trigger haptic feedback on press (default: true) */
  hapticFeedback?: boolean;
  /** The type of haptic feedback (default: 'light') */
  hapticType?: 'light' | 'medium' | 'heavy' | 'selection';
  /** Style for the pressable */
  style?: StyleProp<ViewStyle>;
  /** Children */
  children?: React.ReactNode;
}

const springConfig: WithSpringConfig = {
  damping: 15,
  stiffness: 400,
  mass: 0.5,
};

export function AnimatedPressable({
  pressScale = 0.97,
  hapticFeedback = true,
  hapticType = 'light',
  onPressIn,
  onPressOut,
  onPress,
  style,
  children,
  disabled,
  ...props
}: AnimatedPressableProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      scale.value = withSpring(pressScale, springConfig);

      if (hapticFeedback && !disabled) {
        const impact =
          hapticType === 'selection'
            ? Haptics.selectionAsync()
            : Haptics.impactAsync(
                hapticType === 'heavy'
                  ? Haptics.ImpactFeedbackStyle.Heavy
                  : hapticType === 'medium'
                  ? Haptics.ImpactFeedbackStyle.Medium
                  : Haptics.ImpactFeedbackStyle.Light
              );
        impact.catch(() => {}); // Ignore errors on devices without haptic support
      }

      onPressIn?.(e);
    },
    [scale, pressScale, hapticFeedback, hapticType, disabled, onPressIn]
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      scale.value = withSpring(1, springConfig);
      onPressOut?.(e);
    },
    [scale, onPressOut]
  );

  return (
    <AnimatedPressableComponent
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      disabled={disabled}
      style={[animatedStyle, style]}
      {...props}
    >
      {children}
    </AnimatedPressableComponent>
  );
}

// Preset for cards
export function AnimatedCard({
  children,
  style,
  ...props
}: Omit<AnimatedPressableProps, 'pressScale' | 'hapticType'>) {
  return (
    <AnimatedPressable
      pressScale={0.98}
      hapticType="light"
      style={style}
      {...props}
    >
      {children}
    </AnimatedPressable>
  );
}

// Preset for buttons
export function AnimatedButton({
  children,
  style,
  ...props
}: Omit<AnimatedPressableProps, 'pressScale' | 'hapticType'>) {
  return (
    <AnimatedPressable
      pressScale={0.95}
      hapticType="medium"
      style={style}
      {...props}
    >
      {children}
    </AnimatedPressable>
  );
}

// Preset for list items
export function AnimatedListItem({
  children,
  style,
  ...props
}: Omit<AnimatedPressableProps, 'pressScale' | 'hapticType'>) {
  return (
    <AnimatedPressable
      pressScale={0.99}
      hapticType="selection"
      style={style}
      {...props}
    >
      {children}
    </AnimatedPressable>
  );
}
