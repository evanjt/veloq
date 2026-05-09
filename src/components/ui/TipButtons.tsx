import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, layout, typography } from '@/theme';

const SIZE_LABELS: Record<string, string> = {
  tip_small: 'support.tipSmall',
  tip_medium: 'support.tipMedium',
  tip_large: 'support.tipLarge',
};

interface TipButtonsProps {
  products: { id: string; displayPrice: string }[];
  isPurchasing: boolean;
  onTip: (id: string) => void;
  isDark: boolean;
  small?: boolean;
}

export function TipButtons({ products, isPurchasing, onTip, isDark, small }: TipButtonsProps) {
  const { t } = useTranslation();
  const sorted = [...products].sort((a, b) => {
    const order = ['tip_small', 'tip_medium', 'tip_large'];
    return order.indexOf(a.id) - order.indexOf(b.id);
  });

  return (
    <View style={[styles.tipRow, small && styles.tipRowSmall]}>
      {sorted.map((product) => (
        <Pressable
          key={product.id}
          onPress={() => onTip(product.id)}
          disabled={isPurchasing}
          style={[
            small ? styles.tipButtonSmall : styles.tipButton,
            isDark && styles.tipButtonDark,
            isPurchasing && styles.tipButtonDisabled,
          ]}
        >
          <Text
            style={[small ? styles.tipPriceSmall : styles.tipPrice, isDark && styles.tipTextDark]}
          >
            {product.displayPrice}
          </Text>
          {!small && (
            <Text style={[styles.tipLabel, isDark && styles.tipLabelDark]}>
              {t((SIZE_LABELS[product.id] ?? product.id) as 'support.tipSmall')}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tipRowSmall: {
    gap: spacing.xs,
  },
  tipButton: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    alignItems: 'center',
    minHeight: layout.minTapTarget,
    justifyContent: 'center',
  },
  tipButtonSmall: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusSm,
    alignItems: 'center',
    minHeight: layout.minTapTarget,
    justifyContent: 'center',
  },
  tipButtonDark: {
    backgroundColor: colors.primary,
  },
  tipButtonDisabled: {
    opacity: 0.5,
  },
  tipPrice: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  tipPriceSmall: {
    ...typography.caption,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  tipLabel: {
    ...typography.caption,
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.75)',
    marginTop: 1,
  },
  tipLabelDark: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  tipTextDark: {
    color: '#FFFFFF',
  },
});
