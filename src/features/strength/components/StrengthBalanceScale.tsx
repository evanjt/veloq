import React from 'react';
import { View, StyleSheet } from 'react-native';

import { useTheme } from '@/shared/app';
import { colors, darkColors, opacity, layout, strengthTone } from '@/theme';

interface StrengthBalanceScaleProps {
  leftWeightedSets: number;
  rightWeightedSets: number;
}

/**
 * One antagonist pair's volume split, the left muscle's weighted sets against
 * the right's. A side with no sets keeps a sliver so both colours stay visible.
 */
export function StrengthBalanceScale({
  leftWeightedSets,
  rightWeightedSets,
}: StrengthBalanceScaleProps) {
  const { isDark } = useTheme();

  return (
    <View testID="strength-balance-scale" style={[styles.scale, isDark && styles.scaleDark]}>
      <View style={[styles.side, { flex: Math.max(leftWeightedSets, 0.2) }]} />
      <View style={[styles.gap, isDark && styles.gapDark]} />
      <View style={[styles.sideSecondary, { flex: Math.max(rightWeightedSets, 0.2) }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  scale: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 10,
    borderRadius: layout.borderRadiusFull,
    overflow: 'hidden',
    backgroundColor: opacity.overlay.light,
  },
  scaleDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  side: {
    height: '100%',
    backgroundColor: strengthTone.primary,
  },
  sideSecondary: {
    height: '100%',
    backgroundColor: strengthTone.secondary,
  },
  gap: {
    width: 2,
    height: '100%',
    backgroundColor: colors.surface,
  },
  gapDark: {
    backgroundColor: darkColors.surface,
  },
});
