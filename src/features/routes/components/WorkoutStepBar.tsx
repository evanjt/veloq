import React from 'react';
import { View, StyleSheet } from 'react-native';
import type { FfiStepBlock } from 'veloqrs';
import { useTheme } from '@/shared/app';
import { colourTokens, layout, spacing, zoneColour } from '@/theme';

interface WorkoutStepBarProps {
  /** The engine's blocks for the plan, one per line it follows. */
  blocks: readonly FfiStepBlock[];
  height?: number;
}

/**
 * The workout's structure as a row of blocks, each as wide as its share of
 * the plan. A work block takes the colour of the training zone the engine
 * placed its target in. Rest, and a step with no zone, take the muted chart
 * colour, and rest stands at half height.
 */
export const WorkoutStepBar = React.memo(function WorkoutStepBar({
  blocks,
  height = 6,
}: WorkoutStepBarProps) {
  const { isDark } = useTheme();
  const total = blocks.reduce((sum, block) => sum + block.seconds, 0);
  if (!(total > 0)) return null;

  const muted = colourTokens[isDark ? 'dark' : 'light']['chart-muted'];
  const last = blocks.length - 1;

  return (
    <View testID="workout-step-bar" style={[styles.container, { height }]}>
      {blocks.map((block, i) => (
        <View
          key={i}
          style={[
            styles.block,
            block.rest && styles.rest,
            {
              width: `${(block.seconds / total) * 100}%`,
              backgroundColor:
                !block.rest && block.zone != null ? zoneColour(block.zone, isDark, 'fill') : muted,
            },
            i === 0 && styles.first,
            i === last && styles.last,
          ]}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  block: {
    height: '100%',
  },
  rest: {
    height: '50%',
  },
  first: {
    borderTopLeftRadius: layout.borderRadiusXs,
    borderBottomLeftRadius: layout.borderRadiusXs,
  },
  last: {
    borderTopRightRadius: layout.borderRadiusXs,
    borderBottomRightRadius: layout.borderRadiusXs,
  },
});
