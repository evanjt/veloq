import React from 'react';
import { StyleSheet, Text, View, StyleProp, ViewStyle, TextStyle } from 'react-native';
import { colors, darkColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import { shadows } from '@/theme/shadows';
import { useTheme } from '@/providers/ThemeContext';

type BadgeVariant = 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'muted';
type BadgeSize = 'small' | 'medium';

interface BadgeProps {
  /** Badge text */
  children: string | number;
  /** Badge variant */
  variant?: BadgeVariant;
  /** Badge size */
  size?: BadgeSize;
  /** Icon to show before text */
  icon?: React.ReactNode;
  /** Additional container style */
  style?: StyleProp<ViewStyle>;
  /** Additional text style */
  textStyle?: StyleProp<TextStyle>;
}

export function Badge({
  children,
  variant = 'primary',
  size = 'medium',
  icon,
  style,
  textStyle,
}: BadgeProps) {
  const { isDark } = useTheme();

  const containerStyle = [
    styles.base,
    styles[size],
    getVariantStyle(variant, isDark),
    style,
  ];

  const labelStyle = [
    styles.label,
    styles[`${size}Label`],
    getTextColorStyle(variant, isDark),
    textStyle,
  ];

  return (
    <View style={containerStyle}>
      {icon && <View style={styles.icon}>{icon}</View>}
      <Text style={labelStyle}>{children}</Text>
    </View>
  );
}

function getVariantStyle(variant: BadgeVariant, isDark: boolean): ViewStyle {
  switch (variant) {
    case 'primary':
      return {
        backgroundColor: colors.primary,
        ...shadows.pill,
      };
    case 'secondary':
      return {
        backgroundColor: isDark ? darkColors.surface : colors.background,
        borderWidth: 1,
        borderColor: isDark ? darkColors.border : colors.border,
      };
    case 'success':
      return {
        backgroundColor: colors.success,
        ...shadows.pill,
      };
    case 'warning':
      return {
        backgroundColor: colors.warning,
        ...shadows.pill,
      };
    case 'error':
      return {
        backgroundColor: colors.error,
        ...shadows.pill,
      };
    case 'muted':
      return {
        backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
      };
  }
}

function getTextColorStyle(variant: BadgeVariant, isDark: boolean): TextStyle {
  switch (variant) {
    case 'primary':
    case 'success':
    case 'error':
      return { color: colors.textOnDark };
    case 'warning':
      return { color: colors.textPrimary };
    case 'secondary':
    case 'muted':
      return { color: isDark ? darkColors.textPrimary : colors.textSecondary };
  }
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },

  // Sizes
  small: {
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: 4,
  },
  medium: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 6,
  },

  // Labels
  label: {
    fontWeight: '600',
    textAlign: 'center',
  },
  smallLabel: {
    ...typography.micro,
    fontWeight: '600',
  },
  mediumLabel: {
    ...typography.badge,
  },

  // Icon
  icon: {
    marginRight: spacing.xs / 2,
  },
});

export default Badge;
