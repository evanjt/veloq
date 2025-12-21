import React, { useEffect, useRef, useState } from 'react';
import { Text, View, StyleSheet, Animated, TextStyle } from 'react-native';

interface GlowTextProps {
  children: string | number;
  color?: string;
  glowColor?: string;
  glowIntensity?: number;
  style?: TextStyle;
}

export function GlowText({
  children,
  color = '#FFFFFF',
  glowColor,
  glowIntensity = 8,
  style,
}: GlowTextProps) {
  const actualGlowColor = glowColor || color;

  return (
    <Text
      style={[
        styles.text,
        style,
        {
          color,
          textShadowColor: actualGlowColor,
          textShadowOffset: { width: 0, height: 0 },
          textShadowRadius: glowIntensity,
        },
      ]}
    >
      {children}
    </Text>
  );
}

// GradientText simplified - shows solid color (gradient requires dev build)
export function GradientText({
  children,
  colors = ['#E8C96E', '#D4AF37'],
  style,
}: {
  children: string | number;
  colors?: string[];
  style?: TextStyle;
}) {
  // In Expo Go, just use the first color
  // In dev builds, you could use MaskedView + LinearGradient
  return (
    <Text style={[styles.text, style, { color: colors[0] }]}>
      {children}
    </Text>
  );
}

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  style?: TextStyle;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  color?: string;
  useGlow?: boolean;
  glowColor?: string;
}

export function AnimatedNumber({
  value,
  duration = 800,
  style,
  prefix = '',
  suffix = '',
  decimals = 0,
  color,
  useGlow = false,
  glowColor,
}: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const animatedValue = useRef(new Animated.Value(0)).current;
  const previousValue = useRef(0);

  useEffect(() => {
    const startValue = previousValue.current;
    previousValue.current = value;

    animatedValue.setValue(0);

    const listener = animatedValue.addListener(({ value: animProgress }) => {
      const current = startValue + (value - startValue) * animProgress;
      setDisplayValue(current);
    });

    Animated.timing(animatedValue, {
      toValue: 1,
      duration,
      useNativeDriver: false,
    }).start();

    return () => {
      animatedValue.removeListener(listener);
    };
  }, [value, duration, animatedValue]);

  const formattedValue = `${prefix}${displayValue.toFixed(decimals)}${suffix}`;

  if (useGlow && color) {
    return (
      <GlowText style={style} color={color} glowColor={glowColor || color}>
        {formattedValue}
      </GlowText>
    );
  }

  return (
    <Text style={[styles.text, style, color ? { color } : undefined]}>
      {formattedValue}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    fontSize: 16,
  },
});
