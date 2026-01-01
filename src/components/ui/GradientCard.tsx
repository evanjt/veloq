import React from 'react';
import { View, StyleSheet, ViewStyle, useColorScheme } from 'react-native';
import { shadows, darkColors } from '@/theme';

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
          backgroundColor: isDark ? darkColors.surfaceElevated : '#FFFFFF',
          // Platform-optimized shadows with subtle blue glow in dark mode
          ...(isDark ? shadows.modal : shadows.elevated),
        };
      case 'glass':
        return {
          backgroundColor: isDark ? 'rgba(31, 31, 35, 0.85)' : 'rgba(255, 255, 255, 0.85)',
          borderWidth: 1,
          borderColor: isDark
            ? 'rgba(91, 155, 213, 0.1)' // Subtle blue glow border
            : 'rgba(0, 0, 0, 0.05)',
        };
      default:
        return {
          backgroundColor: isDark ? darkColors.surface : '#FFFFFF',
        };
    }
  };

  return (
    <View style={[styles.card, { borderRadius, padding }, getVariantStyle(), style]}>
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
    <GradientCard variant="glass" style={style} borderRadius={borderRadius} padding={padding}>
      {children}
    </GradientCard>
  );
}

// Preset gradient themes (colors only - use with native LinearGradient in dev builds)
// Primary: Teal | Accent: Gold (achievements) | Secondary: Blue (data)
export const GRADIENT_PRESETS = {
  primary: ['#2DD4BF', '#14B8A6'], // Teal gradient (buttons, CTAs)
  accent: ['#E8C96E', '#D4AF37'], // Gold gradient (achievements only)
  secondary: ['#7DB3E3', '#5B9BD5'], // Blue gradient (data)
  premium: ['#D4AF37', '#5B9BD5'], // Gold to blue (special moments)
  success: ['#4ADE80', '#22C55E'], // Green
  info: ['#7DB3E3', '#5B9BD5'], // Brand blue
  warning: ['#FBBF24', '#F59E0B'], // Amber (NOT orange)
  purple: ['#C084FC', '#A855F7'], // Purple
  ocean: ['#22D3EE', '#06B6D4'], // Cyan
  fitness: ['#7DB3E3', '#5B9BD5'], // Brand blue (CTL)
  fatigue: ['#C084FC', '#A855F7'], // Purple (ATL)
  form: ['#E8C96E', '#D4AF37'], // Gold (TSB - achievement moment!)
  dark: ['rgba(31,31,35,0.95)', 'rgba(24,24,27,0.9)'],
  light: ['rgba(255,255,255,0.95)', 'rgba(248,249,250,0.9)'],
};

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
});
