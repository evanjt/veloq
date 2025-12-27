import React from 'react';
import { StyleSheet, View, StyleProp, ViewStyle, Text, useColorScheme } from 'react-native';
import { colors, darkColors, opacity } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

type DividerVariant = 'full' | 'inset' | 'middle';

interface DividerProps {
  /** Divider variant - full width, inset, or centered */
  variant?: DividerVariant;
  /** Optional label text in the middle */
  label?: string;
  /** Spacing above/below the divider */
  spacing?: 'none' | 'small' | 'medium' | 'large';
  /** Additional style */
  style?: StyleProp<ViewStyle>;
}

export function Divider({
  variant = 'full',
  label,
  spacing: spacingProp = 'small',
  style,
}: DividerProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const dividerColor = isDark ? darkColors.divider : colors.divider;
  const verticalSpacing = getSpacing(spacingProp);

  if (label) {
    return (
      <View style={[styles.labelContainer, { marginVertical: verticalSpacing }, style]}>
        <View style={[styles.line, styles.labelLine, { backgroundColor: dividerColor }]} />
        <Text style={[styles.label, { color: isDark ? darkColors.textSecondary : colors.textSecondary }]}>
          {label}
        </Text>
        <View style={[styles.line, styles.labelLine, { backgroundColor: dividerColor }]} />
      </View>
    );
  }

  const lineStyle = [
    styles.line,
    { backgroundColor: dividerColor },
    variant === 'inset' && styles.inset,
    variant === 'middle' && styles.middle,
    { marginVertical: verticalSpacing },
    style,
  ];

  return <View style={lineStyle} />;
}

function getSpacing(size: 'none' | 'small' | 'medium' | 'large'): number {
  switch (size) {
    case 'none': return 0;
    case 'small': return spacing.xs;
    case 'medium': return spacing.sm;
    case 'large': return spacing.md;
  }
}

const styles = StyleSheet.create({
  line: {
    height: StyleSheet.hairlineWidth,
  },
  inset: {
    marginLeft: spacing.md,
  },
  middle: {
    marginHorizontal: spacing.md,
  },

  // With label
  labelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  labelLine: {
    flex: 1,
  },
  label: {
    ...typography.caption,
    paddingHorizontal: spacing.sm,
  },
});

export default Divider;
