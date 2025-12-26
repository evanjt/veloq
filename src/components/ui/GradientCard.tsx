import React from 'react';
import { View, StyleSheet, ViewStyle, useColorScheme } from 'react-native';
import { shadows } from '@/theme';

interface GradientCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  borderRadius?: number;
  padding?: number;
  variant?: 'default' | 'elevated' | 'glass';
}

export function GradientCard({
  children,
  style,
  borderRadius = 16,
  padding = 16,
  variant = 'default',
}: GradientCardProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const getVariantStyle = () => {
    switch (variant) {
      case 'elevated':
        return {
          backgroundColor: isDark ? '#252525' : '#FFFFFF',
          // Platform-optimized shadows
          ...(isDark ? shadows.modal : shadows.elevated),
        };
      case 'glass':
        return {
          backgroundColor: isDark
            ? 'rgba(40, 40, 40, 0.85)'
            : 'rgba(255, 255, 255, 0.85)',
          borderWidth: 1,
          borderColor: isDark
            ? 'rgba(255, 255, 255, 0.1)'
            : 'rgba(0, 0, 0, 0.05)',
        };
      default:
        return {
          backgroundColor: isDark ? '#1E1E1E' : '#FFFFFF',
        };
    }
  };

  return (
    <View
      style={[
        styles.card,
        { borderRadius, padding },
        getVariantStyle(),
        style,
      ]}
    >
      {children}
    </View>
  );
}

// Simplified glass card without blur (works in Expo Go)
export function GlassCard({
  children,
  style,
  borderRadius = 16,
  padding = 16,
}: Omit<GradientCardProps, 'variant'>) {
  return (
    <GradientCard
      variant="glass"
      style={style}
      borderRadius={borderRadius}
      padding={padding}
    >
      {children}
    </GradientCard>
  );
}

// Preset gradient themes (colors only - use with native LinearGradient in dev builds)
export const GRADIENT_PRESETS = {
  primary: ['#FF6B2C', '#FC4C02'],
  success: ['#66BB6A', '#4CAF50'],
  info: ['#42A5F5', '#2196F3'],
  warning: ['#FFB74D', '#FF9800'],
  purple: ['#AB47BC', '#9C27B0'],
  sunset: ['#FF6B2C', '#FF8F4C', '#FFB74D'],
  ocean: ['#0099FF', '#42A5F5', '#00BCD4'],
  fitness: ['#42A5F5', '#2196F3'],
  fatigue: ['#FF7043', '#FF5722'],
  form: ['#66BB6A', '#4CAF50'],
  dark: ['rgba(40,40,40,0.95)', 'rgba(30,30,30,0.9)'],
  light: ['rgba(255,255,255,0.95)', 'rgba(250,250,250,0.9)'],
};

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
});
