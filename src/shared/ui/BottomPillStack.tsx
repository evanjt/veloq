import React, { type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { BOTTOM_PILL_ORDER, footCover, useBottomPills, type BottomPillKey } from './bottomPills';
import { bottomPillStack, useBottomClearance } from './tabBarClearance';
import { floatingLayers } from '@/theme';

interface BottomPillStackProps {
  /** Each pill, which draws nothing while it has nothing to say. */
  pills: Record<BottomPillKey, ReactNode>;
}

/**
 * The one place the bottom pills are drawn. Each sits in a slot the stack places, so two pills
 * that show at once stack rather than drawing on one spot. Rendered once in the root layout.
 */
export function BottomPillStack({ pills }: BottomPillStackProps) {
  // Floats absolute, so a safe area around it does not lift it by its padding.
  const clearance = useBottomClearance({ insetTaken: false });
  const heights = useBottomPills((s) => s.heights);
  const cover = useBottomPills((s) => footCover(s.covers));
  const setHeight = useBottomPills((s) => s.setHeight);

  const shown = BOTTOM_PILL_ORDER.filter((pill) => heights[pill] !== undefined);
  // A pill not measured yet takes the slot above the shown ones, where it overlaps nothing.
  const bottoms = bottomPillStack({
    clearance,
    cover,
    heights: [...shown.map((pill) => heights[pill] ?? 0), 0],
  });
  const unmeasured = bottoms[bottoms.length - 1];

  return (
    <>
      {BOTTOM_PILL_ORDER.map((pill) => {
        const index = shown.indexOf(pill);
        const bottom = index === -1 ? unmeasured : bottoms[index];
        return (
          <View
            key={pill}
            testID={`bottom-pill-${pill}`}
            style={[styles.slot, { bottom }]}
            pointerEvents="box-none"
            onLayout={(event: LayoutChangeEvent) =>
              setHeight(pill, event.nativeEvent.layout.height)
            }
          >
            {pills[pill]}
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  slot: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: floatingLayers.returnPills,
  },
});
