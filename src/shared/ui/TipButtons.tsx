import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { spacing, themePalette, typography } from '@/theme';
import { Button } from '@/shared/ui/Button';

const SIZE_LABELS: Record<string, string> = {
  tip_small: 'support.tipSmall',
  tip_medium: 'support.tipMedium',
  tip_large: 'support.tipLarge',
};

const ORDER = ['tip_small', 'tip_medium', 'tip_large'];

interface TipButtonsProps {
  products: { id: string; displayPrice: string }[];
  isPurchasing: boolean;
  onTip: (id: string) => void;
  small?: boolean;
}

/**
 * The tip options, one secondary `Button` each, under one line saying a tip unlocks
 * nothing. A tip sits beside a screen's own primary action, so it takes the second
 * rank. The price is the label, and the size leads the accessible name.
 */
export function TipButtons({ products, isPurchasing, onTip, small }: TipButtonsProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const sorted = [...products].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

  return (
    <View>
      <Text style={[styles.note, { color: palette.textSecondary }]}>{t('support.tipNote')}</Text>
      <View style={[styles.tipRow, small && styles.tipRowSmall]}>
        {sorted.map((product) => (
          <Button
            key={product.id}
            label={product.displayPrice}
            accessibilityLabel={`${t(
              (SIZE_LABELS[product.id] ?? product.id) as 'support.tipSmall'
            )} ${product.displayPrice}`}
            onPress={() => onTip(product.id)}
            variant="secondary"
            size={small ? 'sm' : 'md'}
            disabled={isPurchasing}
            style={small ? undefined : styles.tipButton}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    ...typography.caption,
    marginBottom: spacing.xs,
  },
  tipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tipRowSmall: {
    gap: spacing.xs,
  },
  tipButton: {
    flex: 1,
  },
});
