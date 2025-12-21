import React from 'react';
import { View, StyleSheet, ViewStyle, useColorScheme, Platform } from 'react-native';

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
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: isDark ? 0.3 : 0.1,
          shadowRadius: 12,
          elevation: 6,
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
  primary: ['#E8C96E', '#D4AF37'],
  success: ['#66BB6A', '#4CAF50'],
  info: ['#42A5F5', '#2196F3'],
  warning: ['#FBBF24', '#F59E0B'],
  purple: ['#AB47BC', '#9C27B0'],
  sunset: ['#E8C96E', '#FF8F4C', '#FBBF24'],
  ocean: ['#0099FF', '#42A5F5', '#00BCD4'],
  fitness: ['#42A5F5', '#2196F3'],
  fatigue: ['#A855F7', '#5B9BD5'],
  form: ['#66BB6A', '#4CAF50'],
  dark: ['rgba(40,40,40,0.95)', 'rgba(30,30,30,0.9)'],
  light: ['rgba(255,255,255,0.95)', 'rgba(250,250,250,0.9)'],
};

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
});
