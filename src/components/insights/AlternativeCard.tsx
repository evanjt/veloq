import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, shadows } from '@/theme';
import type { InsightAlternative } from '@/types';

const CARD_WIDTH = Dimensions.get('window').width * 0.7;
const SELECTED_COLOR = '#FC4C02';

interface AlternativeCardProps {
  alternative: InsightAlternative;
}

export const AlternativeCard = React.memo(function AlternativeCard({
  alternative,
}: AlternativeCardProps) {
  const { isDark } = useTheme();

  return (
    <View
      style={[
        styles.card,
        isDark && styles.cardDark,
        alternative.isSelected && styles.cardSelected,
        alternative.isSelected && isDark && styles.cardSelectedDark,
        !alternative.isSelected && styles.cardUnselected,
      ]}
    >
      <View style={styles.header}>
        <View
          style={[
            styles.statusDot,
            {
              backgroundColor: alternative.isSelected
                ? SELECTED_COLOR
                : isDark
                  ? darkColors.textDisabled
                  : colors.gray400,
            },
          ]}
        />
        <Text
          style={[
            styles.label,
            isDark && styles.labelDark,
            alternative.isSelected && styles.labelSelected,
          ]}
          numberOfLines={1}
        >
          {alternative.label}
        </Text>
      </View>
      <Text style={[styles.reasoning, isDark && styles.reasoningDark]} numberOfLines={3}>
        {alternative.reasoning}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: spacing.md,
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  cardDark: {
    backgroundColor: darkColors.surfaceCard,
    borderColor: darkColors.border,
    ...shadows.none,
  },
  cardSelected: {
    borderColor: SELECTED_COLOR,
    borderWidth: 2,
    ...shadows.elevated,
  },
  cardSelectedDark: {
    borderColor: SELECTED_COLOR,
    ...shadows.none,
  },
  cardUnselected: {
    opacity: 0.6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.sm,
  },
  label: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  labelDark: {
    color: darkColors.textPrimary,
  },
  labelSelected: {
    color: SELECTED_COLOR,
  },
  reasoning: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  reasoningDark: {
    color: darkColors.textSecondary,
  },
});

export { CARD_WIDTH };
