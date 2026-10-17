import React, { useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { BOTTOM_PILL_ORDER, footCover, useBottomPills, type BottomPillKey } from './bottomPills';
import { bottomPillStack, useBottomClearance } from './tabBarClearance';
import { floatingLayers } from '@/theme';

/**
 * Where a pill's slot sits. A pill not measured yet takes the slot above the shown ones, where
 * it overlaps nothing.
 */
function useBottomPillBottom(pill: BottomPillKey): number {
  // Floats absolute, so a safe area around it does not lift it by its padding.
  const clearance = useBottomClearance({ insetTaken: false });
  const heights = useBottomPills((s) => s.heights);
  const cover = useBottomPills((s) => footCover(s.covers));

  const shown = BOTTOM_PILL_ORDER.filter((key) => heights[key] !== undefined);
  const bottoms = bottomPillStack({
    clearance,
    cover,
    heights: [...shown.map((key) => heights[key] ?? 0), 0],
  });
  const index = shown.indexOf(pill);
  // The stack places one slot past the shown pills, so every slot it is asked for exists.
  return bottoms[index === -1 ? shown.length : index] ?? clearance;
}

interface BottomPillSlotProps {
  pill: BottomPillKey;
  children: ReactNode;
  /** The layer among the host's children, the floating band at the root unless it says. */
  layer?: number;
}

/**
 * One pill's place in the bottom stack, drawn by whichever host owns the pill. It reports its
 * height as it lays out and gives up its place when it goes, so the pills above it close the gap.
 */
export function BottomPillSlot({
  pill,
  children,
  layer = floatingLayers.returnPills,
}: BottomPillSlotProps) {
  const bottom = useBottomPillBottom(pill);
  const setHeight = useBottomPills((s) => s.setHeight);
  useEffect(() => () => useBottomPills.getState().setHeight(pill, null), [pill]);

  return (
    <View
      testID={`bottom-pill-${pill}`}
      style={[styles.slot, { bottom, zIndex: layer }]}
      pointerEvents="box-none"
      onLayout={(event: LayoutChangeEvent) => setHeight(pill, event.nativeEvent.layout.height)}
    >
      {children}
    </View>
  );
}

interface BottomPillStackProps {
  /** Each pill the root draws, which draws nothing while it has nothing to say. */
  pills: Partial<Record<BottomPillKey, ReactNode>>;
}

/**
 * The bottom pills the root layout draws, each in its slot, so two pills that show at once stack
 * rather than drawing on one spot. A pill a screen owns renders its own `BottomPillSlot`.
 */
export function BottomPillStack({ pills }: BottomPillStackProps) {
  return (
    <>
      {BOTTOM_PILL_ORDER.filter((pill) => pill in pills).map((pill) => (
        <BottomPillSlot key={pill} pill={pill}>
          {pills[pill]}
        </BottomPillSlot>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  slot: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
