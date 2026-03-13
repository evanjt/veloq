import React, { useRef, useMemo } from 'react';
import { FlatList, View, StyleSheet, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing } from '@/theme';
import { AlternativeCard, CARD_WIDTH } from './AlternativeCard';
import type { InsightAlternative } from '@/types';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SIDE_PADDING = (SCREEN_WIDTH - CARD_WIDTH) / 2;

interface AlternativesCarouselProps {
  alternatives: InsightAlternative[];
}

export const AlternativesCarousel = React.memo(function AlternativesCarousel({
  alternatives,
}: AlternativesCarouselProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const listRef = useRef<FlatList<InsightAlternative>>(null);

  const selectedIndex = useMemo(
    () =>
      Math.max(
        0,
        alternatives.findIndex((a) => a.isSelected)
      ),
    [alternatives]
  );

  const renderItem = ({ item }: { item: InsightAlternative }) => (
    <AlternativeCard alternative={item} />
  );

  const keyExtractor = (item: InsightAlternative) => item.key;

  return (
    <View style={styles.container}>
      <Text style={[styles.header, isDark && styles.headerDark]}>
        {t('insights.whyThisRecommendation', 'Why this recommendation?')}
      </Text>
      <FlatList
        ref={listRef}
        data={alternatives}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_WIDTH + spacing.sm}
        decelerationRate="fast"
        contentContainerStyle={[
          styles.listContent,
          { paddingLeft: SIDE_PADDING, paddingRight: SIDE_PADDING },
        ]}
        initialScrollIndex={selectedIndex}
        getItemLayout={(_, index) => ({
          length: CARD_WIDTH + spacing.sm,
          offset: (CARD_WIDTH + spacing.sm) * index,
          index,
        })}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.md,
  },
  header: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  headerDark: {
    color: darkColors.textSecondary,
  },
  listContent: {
    paddingVertical: spacing.xs,
  },
});
