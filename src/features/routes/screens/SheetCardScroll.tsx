/**
 * The scroll of a card in a map sheet that is not a detail subject's own, a section's history or
 * its laps. The sheet draws the ground, the end clears the bottom edge, and a pushed card keeps
 * its top clear of the close control drawn over it. On its own screen the route passes its
 * screen's scroll instead.
 */
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { useMapSheetCard } from '@/shared/app/MapSheetHost';
import { useBottomClearance } from '@/shared/ui';
import { controlHeight, layout, spacing } from '@/theme';

/** What a card's scroll is handed: the card's body. */
export interface CardScrollProps {
  children: React.ReactNode;
}

export function SheetCardScroll({ children }: CardScrollProps) {
  const pushed = (useMapSheetCard()?.index ?? 0) > 0;
  const bottomClearance = useBottomClearance();
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
