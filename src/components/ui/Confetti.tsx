/**
 * Confetti celebration animation component.
 *
 * Used to celebrate achievements like personal records, milestones, etc.
 * Uses React Native Reanimated for smooth 60fps animations.
 */

import React, { useEffect, useImperativeHandle, forwardRef, useState, useCallback } from 'react';
import { StyleSheet, Dimensions, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors } from '@/theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Confetti colors - vibrant celebration palette
const CONFETTI_COLORS = [
  colors.primary, // Orange (brand)
  colors.chartYellow, // Gold
  colors.success, // Green
  colors.chartBlue, // Blue
  colors.chartPink, // Pink
  colors.chartPurple, // Purple
  colors.chartCyan, // Cyan
];

// Particle shapes
type ParticleShape = 'square' | 'rectangle' | 'circle';

interface Particle {
  id: number;
  x: number;
  y: number;
  color: string;
  shape: ParticleShape;
  size: number;
  rotation: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
}

interface ConfettiProps {
  /** Number of confetti particles (default: 50) */
  particleCount?: number;
  /** Duration of the animation in ms (default: 3000) */
  duration?: number;
  /** Whether to trigger haptic feedback (default: true) */
  hapticFeedback?: boolean;
  /** Callback when animation completes */
  onComplete?: () => void;
  /** Custom colors array (default: celebration palette) */
  colors?: string[];
}

export interface ConfettiRef {
  /** Trigger the confetti animation */
  fire: () => void;
}

function generateParticles(count: number, particleColors: string[]): Particle[] {
  const particles: Particle[] = [];
  const shapes: ParticleShape[] = ['square', 'rectangle', 'circle'];

  for (let i = 0; i < count; i++) {
    particles.push({
      id: i,
      // Start from center-top area with some spread
      x: SCREEN_WIDTH * 0.3 + Math.random() * SCREEN_WIDTH * 0.4,
      y: -20 - Math.random() * 50,
      color: particleColors[Math.floor(Math.random() * particleColors.length)],
      shape: shapes[Math.floor(Math.random() * shapes.length)],
      size: 6 + Math.random() * 8,
      rotation: Math.random() * 360,
      // Horizontal velocity - spread outward
      velocityX: (Math.random() - 0.5) * 8,
      // Vertical velocity - initial upward burst then gravity
      velocityY: -2 - Math.random() * 4,
      rotationSpeed: (Math.random() - 0.5) * 720,
    });
  }

  return particles;
}

interface ConfettiParticleProps {
  particle: Particle;
  isActive: boolean;
  duration: number;
  onComplete?: () => void;
  index: number;
  totalParticles: number;
}

function ConfettiParticle({
  particle,
  isActive,
  duration,
  onComplete,
  index,
  totalParticles,
}: ConfettiParticleProps) {
  const translateX = useSharedValue(particle.x);
  const translateY = useSharedValue(particle.y);
  const rotation = useSharedValue(particle.rotation);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      // Stagger the start of each particle slightly
      const staggerDelay = (index / totalParticles) * 200;

      // Initial pop-in
      opacity.value = withDelay(staggerDelay, withTiming(1, { duration: 100 }));
      scale.value = withDelay(staggerDelay, withTiming(1, { duration: 150 }));

      // Physics simulation
      const gravity = 0.15;
      const airResistance = 0.98;
      let vx = particle.velocityX;
      let vy = particle.velocityY;
      let x = particle.x;
      let y = particle.y;

      // Calculate final position based on physics
      const steps = Math.floor(duration / 16); // ~60fps
      for (let i = 0; i < steps; i++) {
        vy += gravity;
        vx *= airResistance;
        vy *= airResistance;
        x += vx;
        y += vy;
      }

      // Animate to final position
      translateX.value = withDelay(
        staggerDelay,
        withTiming(x, {
          duration: duration - staggerDelay,
          easing: Easing.out(Easing.quad),
        })
      );

      translateY.value = withDelay(
        staggerDelay,
        withTiming(y + SCREEN_HEIGHT * 0.8, {
          duration: duration - staggerDelay,
          easing: Easing.in(Easing.quad),
        })
      );

      // Rotation animation
      rotation.value = withDelay(
        staggerDelay,
        withTiming(particle.rotation + particle.rotationSpeed, {
          duration: duration - staggerDelay,
          easing: Easing.linear,
        })
      );

      // Fade out at the end
      opacity.value = withDelay(
        staggerDelay,
        withSequence(
          withTiming(1, { duration: 100 }),
          withDelay(duration * 0.6, withTiming(0, { duration: duration * 0.3 }))
        )
      );

      // Notify completion for the last particle
      if (index === totalParticles - 1 && onComplete) {
        const completeTimeout = setTimeout(() => {
          onComplete();
        }, duration + 100);
        return () => clearTimeout(completeTimeout);
      }
    } else {
      // Reset
      translateX.value = particle.x;
      translateY.value = particle.y;
      rotation.value = particle.rotation;
      opacity.value = 0;
      scale.value = 0;
    }
  }, [
    isActive,
    particle,
    duration,
    index,
    totalParticles,
    onComplete,
    translateX,
    translateY,
    rotation,
    opacity,
    scale,
  ]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${rotation.value}deg` },
      { scale: scale.value },
    ],
    opacity: opacity.value,
  }));

  const shapeStyle = getShapeStyle(particle.shape, particle.size, particle.color);

  return <Animated.View style={[styles.particle, animatedStyle, shapeStyle]} />;
}

function getShapeStyle(shape: ParticleShape, size: number, color: string) {
  switch (shape) {
    case 'circle':
      return {
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
      };
    case 'rectangle':
      return {
        width: size * 0.5,
        height: size * 1.5,
        borderRadius: 2,
        backgroundColor: color,
      };
    case 'square':
    default:
      return {
        width: size,
        height: size,
        borderRadius: 2,
        backgroundColor: color,
      };
  }
}

export const Confetti = forwardRef<ConfettiRef, ConfettiProps>(function Confetti(
  { particleCount = 50, duration = 3000, hapticFeedback = true, onComplete, colors: customColors },
  ref
) {
  const [isActive, setIsActive] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);

  const fire = useCallback(() => {
    // Generate new particles
    const newParticles = generateParticles(particleCount, customColors || CONFETTI_COLORS);
    setParticles(newParticles);
    setIsActive(true);

    // Haptic feedback
    if (hapticFeedback) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }, [particleCount, customColors, hapticFeedback]);

  const handleComplete = useCallback(() => {
    setIsActive(false);
    onComplete?.();
  }, [onComplete]);

  useImperativeHandle(
    ref,
    () => ({
      fire,
    }),
    [fire]
  );

  if (!isActive || particles.length === 0) {
    return null;
  }

  return (
    <View style={styles.container} pointerEvents="none">
      {particles.map((particle, index) => (
        <ConfettiParticle
          key={particle.id}
          particle={particle}
          isActive={isActive}
          duration={duration}
          onComplete={index === particles.length - 1 ? handleComplete : undefined}
          index={index}
          totalParticles={particles.length}
        />
      ))}
    </View>
  );
});

// Convenience component that auto-fires on mount
export function ConfettiCelebration({ onComplete, ...props }: Omit<ConfettiProps, 'ref'>) {
  const confettiRef = React.useRef<ConfettiRef>(null);

  useEffect(() => {
    // Small delay to ensure component is mounted
    const timer = setTimeout(() => {
      confettiRef.current?.fire();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return <Confetti ref={confettiRef} onComplete={onComplete} {...props} />;
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
  },
  particle: {
    position: 'absolute',
  },
});
