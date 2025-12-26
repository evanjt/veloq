import React from 'react';
import { StyleSheet, Text, View, ActivityIndicator, StyleProp, ViewStyle, TextStyle } from 'react-native';
import { AnimatedPressable } from './AnimatedPressable';
import { colors, darkColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import { shadows } from '@/theme/shadows';
import { useTheme } from '@/providers/ThemeContext';

type ButtonVariant = 'primary' | 'secondary' | 'subtle' | 'danger';
type ButtonSize = 'small' | 'medium' | 'large';

interface ButtonProps {
  /** Button text */
  children: string;
  /** Button variant */
  variant?: ButtonVariant;
  /** Button size */
  size?: ButtonSize;
  /** Disabled state */
  disabled?: boolean;
  /** Loading state */
  loading?: boolean;
  /** Icon to show before text */
  icon?: React.ReactNode;
  /** Icon to show after text */
  iconRight?: React.ReactNode;
  /** Full width */
  fullWidth?: boolean;
  /** Press handler */
  onPress?: () => void;
  /** Additional container style */
  style?: StyleProp<ViewStyle>;
  /** Additional text style */
  textStyle?: StyleProp<TextStyle>;
}

export function Button({
  children,
  variant = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  icon,
  iconRight,
  fullWidth = false,
  onPress,
  style,
  textStyle,
}: ButtonProps) {
  const { isDark } = useTheme();

  const isDisabled = disabled || loading;

  const containerStyle = [
    styles.base,
    styles[size],
    getVariantStyle(variant, isDark, isDisabled),
    fullWidth && styles.fullWidth,
    style,
  ];

  const labelStyle = [
    styles.label,
    styles[`${size}Label`],
    getTextStyle(variant, isDark, isDisabled),
    textStyle,
  ];

  const spinnerColor = variant === 'primary' || variant === 'danger'
    ? colors.textOnDark
    : isDark ? darkColors.textPrimary : colors.primary;

  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={isDisabled}
      pressScale={0.96}
      hapticType="medium"
      style={containerStyle}
    >
      {loading ? (
        <ActivityIndicator size="small" color={spinnerColor} />
      ) : (
        <View style={styles.content}>
          {icon && <View style={styles.iconLeft}>{icon}</View>}
          <Text style={labelStyle}>{children}</Text>
          {iconRight && <View style={styles.iconRight}>{iconRight}</View>}
        </View>
      )}
    </AnimatedPressable>
  );
}

function getVariantStyle(variant: ButtonVariant, isDark: boolean, disabled: boolean): ViewStyle {
  const opacity = disabled ? 0.5 : 1;

  switch (variant) {
    case 'primary':
      return {
        backgroundColor: colors.primary,
        opacity,
        ...shadows.button,
      };
    case 'secondary':
      return {
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderColor: isDark ? darkColors.border : colors.border,
        opacity,
      };
    case 'subtle':
      return {
        backgroundColor: 'transparent',
        opacity,
      };
    case 'danger':
      return {
        backgroundColor: colors.error,
        opacity,
        ...shadows.button,
      };
  }
}

function getTextStyle(variant: ButtonVariant, isDark: boolean, disabled: boolean): TextStyle {
  switch (variant) {
    case 'primary':
    case 'danger':
      return { color: colors.textOnDark };
    case 'secondary':
    case 'subtle':
      return {
        color: disabled
          ? colors.textDisabled
          : isDark
          ? darkColors.textPrimary
          : colors.textPrimary,
      };
  }
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: layout.borderRadiusSm,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },

  // Sizes
  small: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    minHeight: 32,
  },
  medium: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: layout.minTapTarget,
  },
  large: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    minHeight: 52,
  },

  // Labels
  label: {
    ...typography.bodyBold,
    textAlign: 'center',
  },
  smallLabel: {
    fontSize: 13,
    lineHeight: 18,
  },
  mediumLabel: {
    fontSize: 15,
    lineHeight: 20,
  },
  largeLabel: {
    fontSize: 16,
    lineHeight: 22,
  },

  // Icons
  iconLeft: {
    marginRight: spacing.xs,
  },
  iconRight: {
    marginLeft: spacing.xs,
  },
});

export default Button;
