/**
 * Screen transition animation components.
 *
 * Provides consistent entrance animations for screen content.
 * Uses React Native Reanimated's layout animations for 60fps performance.
 */

import React from 'react';
import { StyleSheet, ViewStyle, StyleProp } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeInLeft,
  FadeInRight,
  SlideInDown,
  SlideInUp,
  SlideInLeft,
  SlideInRight,
  ZoomIn,
  ZoomInDown,
  ZoomInUp,
  BounceIn,
  BounceInDown,
  withSpring,
  withTiming,
  Easing,
  EntryExitAnimationFunction,
  LayoutAnimationConfig,
} from 'react-native-reanimated';

// Animation presets
export type AnimationPreset =
  | 'fadeIn'
  | 'fadeInDown'
  | 'fadeInUp'
  | 'fadeInLeft'
  | 'fadeInRight'
  | 'slideInDown'
  | 'slideInUp'
  | 'slideInLeft'
  | 'slideInRight'
  | 'zoomIn'
  | 'zoomInDown'
  | 'zoomInUp'
  | 'bounceIn'
  | 'bounceInDown'
  | 'springIn'
  | 'none';

interface ScreenTransitionProps {
  /** Animation preset to use (default: 'fadeInDown') */
  animation?: AnimationPreset;
  /** Delay before animation starts in ms (default: 0) */
  delay?: number;
  /** Duration of the animation in ms (default: 400) */
  duration?: number;
  /** Children to animate */
  children: React.ReactNode;
  /** Additional style */
  style?: StyleProp<ViewStyle>;
}

// Custom spring-in animation
const springInAnimation = (delay: number = 0, duration: number = 400) => {
  'worklet';
  return {
    initialValues: {
      opacity: 0,
      transform: [{ scale: 0.9 }, { translateY: 20 }],
    },
    animations: {
      opacity: withTiming(1, { duration: duration * 0.5 }),
      transform: [
        { scale: withSpring(1, { damping: 15, stiffness: 300 }) },
        { translateY: withSpring(0, { damping: 15, stiffness: 300 }) },
      ],
    },
  };
};

function getEnteringAnimation(preset: AnimationPreset, delay: number, duration: number) {
  switch (preset) {
    case 'fadeIn':
      return FadeIn.delay(delay).duration(duration);
    case 'fadeInDown':
      return FadeInDown.delay(delay).duration(duration).easing(Easing.out(Easing.cubic));
    case 'fadeInUp':
      return FadeInUp.delay(delay).duration(duration).easing(Easing.out(Easing.cubic));
    case 'fadeInLeft':
      return FadeInLeft.delay(delay).duration(duration).easing(Easing.out(Easing.cubic));
    case 'fadeInRight':
      return FadeInRight.delay(delay).duration(duration).easing(Easing.out(Easing.cubic));
    case 'slideInDown':
      return SlideInDown.delay(delay).duration(duration).easing(Easing.out(Easing.cubic));
    case 'slideInUp':
      return SlideInUp.delay(delay).duration(duration).easing(Easing.out(Easing.cubic));
    case 'slideInLeft':
      return SlideInLeft.delay(delay).duration(duration).easing(Easing.out(Easing.cubic));
    case 'slideInRight':
      return SlideInRight.delay(delay).duration(duration).easing(Easing.out(Easing.cubic));
    case 'zoomIn':
      return ZoomIn.delay(delay).duration(duration);
    case 'zoomInDown':
      return ZoomInDown.delay(delay).duration(duration);
    case 'zoomInUp':
      return ZoomInUp.delay(delay).duration(duration);
    case 'bounceIn':
      return BounceIn.delay(delay).duration(duration);
    case 'bounceInDown':
      return BounceInDown.delay(delay).duration(duration);
    case 'springIn':
      return springInAnimation(delay, duration) as unknown as EntryExitAnimationFunction;
    case 'none':
    default:
      return undefined;
  }
}

/**
 * Animated container for screen content with entrance animation.
 */
export function ScreenTransition({
  animation = 'fadeInDown',
  delay = 0,
  duration = 400,
  children,
  style,
}: ScreenTransitionProps) {
  const entering = getEnteringAnimation(animation, delay, duration);

  if (animation === 'none' || !entering) {
    return <Animated.View style={[styles.container, style]}>{children}</Animated.View>;
  }

  return (
    <Animated.View entering={entering} style={[styles.container, style]}>
      {children}
    </Animated.View>
  );
}

/**
 * Staggered list item animation.
 * Use this to animate items in a list with a staggered delay.
 */
interface StaggeredItemProps {
  /** Index of the item in the list */
  index: number;
  /** Base delay between items in ms (default: 50) */
  staggerDelay?: number;
  /** Animation preset (default: 'fadeInUp') */
  animation?: AnimationPreset;
  /** Duration of each item's animation (default: 300) */
  duration?: number;
  /** Children to animate */
  children: React.ReactNode;
  /** Additional style */
  style?: StyleProp<ViewStyle>;
}

export function StaggeredItem({
  index,
  staggerDelay = 50,
  animation = 'fadeInUp',
  duration = 300,
  children,
  style,
}: StaggeredItemProps) {
  const delay = index * staggerDelay;
  const entering = getEnteringAnimation(animation, delay, duration);

  if (!entering) {
    return <Animated.View style={style}>{children}</Animated.View>;
  }

  return (
    <Animated.View entering={entering} style={style}>
      {children}
    </Animated.View>
  );
}

/**
 * Animated section header with fade-in animation.
 */
interface AnimatedSectionProps {
  /** Delay before animation starts (default: 100) */
  delay?: number;
  /** Children to animate */
  children: React.ReactNode;
  /** Additional style */
  style?: StyleProp<ViewStyle>;
}

export function AnimatedSection({ delay = 100, children, style }: AnimatedSectionProps) {
  return (
    <Animated.View
      entering={FadeInDown.delay(delay).duration(400).easing(Easing.out(Easing.cubic))}
      style={style}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Animated card with pop-in effect.
 */
interface AnimatedCardEntranceProps {
  /** Index for staggered animation (default: 0) */
  index?: number;
  /** Children to animate */
  children: React.ReactNode;
  /** Additional style */
  style?: StyleProp<ViewStyle>;
}

export function AnimatedCardEntrance({ index = 0, children, style }: AnimatedCardEntranceProps) {
  const delay = 100 + index * 75;

  return (
    <Animated.View
      entering={ZoomIn.delay(delay).duration(350).springify().damping(15).stiffness(300)}
      style={style}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Hero stat animation - large number that counts up with a pop effect.
 */
interface HeroStatEntranceProps {
  /** Delay before animation (default: 200) */
  delay?: number;
  /** Children to animate */
  children: React.ReactNode;
  /** Additional style */
  style?: StyleProp<ViewStyle>;
}

export function HeroStatEntrance({ delay = 200, children, style }: HeroStatEntranceProps) {
  return (
    <Animated.View entering={BounceInDown.delay(delay).duration(600)} style={style}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
