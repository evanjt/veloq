/**
 * The scroll of a card in a map sheet that is not a detail subject's own, a section's history or
 * its laps. The sheet draws the ground, the end clears the bottom edge, and a pushed card keeps
 * its top clear of the close control drawn over it. It scrolls nested, since Android's sheet hands
 * a drag to its content only through a view that does and otherwise moves itself on every drag.
 * On its own screen the route passes its screen's scroll instead.
 */
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { useMapSheetCard } from '@/shared/app/MapSheetHost';
import { useBottomClearance } from '@/shared/ui';
import { usePagerPageScrollProps } from '@/shared/ui/pagerPageScroll';
import { controlHeight, layout, spacing } from '@/theme';

/** What a card's scroll is handed: the card's body. */
export interface CardScrollProps {
  children: React.ReactNode;
}

export function SheetCardScroll({ children }: CardScrollProps) {
  const pushed = (useMapSheetCard()?.index ?? 0) > 0;
  const bottomClearance = useBottomClearance();
  const pageScroll = usePagerPageScrollProps();
  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[
        styles.content,
        pushed && styles.clearOfClose,
        { paddingBottom: spacing.xl + bottomClearance },
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      {...pageScroll}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: layout.screenPadding },
  clearOfClose: { paddingTop: controlHeight.buttonSm + spacing.sm },
});
