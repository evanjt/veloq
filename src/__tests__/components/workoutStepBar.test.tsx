/**
 * Scenario: the engine walks a planned workout's steps into blocks, each
 * carrying the training zone its target falls in for this athlete.
 *
 * Expected behaviour: a work block takes its zone's fill, a rest block and a
 * block with no zone take the muted chart colour, a rest block stands at half
 * height, and each block's width is its share of the plan's seconds.
 */

import React from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { render } from '@testing-library/react-native';
import type { FfiStepBlock } from 'veloqrs';

import { WorkoutStepBar } from '@/features/routes/components/WorkoutStepBar';
import { colourTokens, zoneColour } from '@/theme';

let mockDark = false;
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockDark }) }));

const BLOCKS: FfiStepBlock[] = [
  { seconds: 300, zone: 5, rest: false },
  { seconds: 120, rest: true },
  { seconds: 240, rest: false },
  { seconds: 60, zone: 2, rest: false },
];

async function drawn(blocks: FfiStepBlock[]): Promise<ViewStyle[]> {
  const { getByTestId } = await render(<WorkoutStepBar blocks={blocks} />);
  return getByTestId('workout-step-bar').children.map(
    (child) => StyleSheet.flatten(typeof child === 'string' ? {} : child.props.style) as ViewStyle
  );
}

describe('WorkoutStepBar', () => {
  beforeEach(() => {
    mockDark = false;
  });

  it('fills a work block with its zone and mutes rest and an unzoned step', async () => {
    const styles = await drawn(BLOCKS);
    expect(styles.map((s) => s.backgroundColor)).toEqual([
      zoneColour(5, false),
      colourTokens.light['chart-muted'],
      colourTokens.light['chart-muted'],
      zoneColour(2, false),
    ]);
  });

  it('draws rest at half height and every other block at full height', async () => {
    const styles = await drawn(BLOCKS);
    expect(styles.map((s) => s.height)).toEqual(['100%', '50%', '100%', '100%']);
  });

  it('gives each block its share of the plan seconds', async () => {
    const styles = await drawn(BLOCKS);
    const widths = styles.map((s) => parseFloat(String(s.width)));
    [300, 120, 240, 60].forEach((seconds, i) =>
      expect(widths[i]).toBeCloseTo((seconds / 720) * 100)
    );
  });

  it('takes the dark ladder in the dark theme', async () => {
    mockDark = true;
    const styles = await drawn(BLOCKS);
    expect(styles[0].backgroundColor).toBe(zoneColour(5, true));
    expect(styles[1].backgroundColor).toBe(colourTokens.dark['chart-muted']);
  });

  it('draws nothing for a plan with no blocks or no seconds', async () => {
    const empty = await render(<WorkoutStepBar blocks={[]} />);
    expect(empty.queryByTestId('workout-step-bar')).toBeNull();
    const zero = await render(<WorkoutStepBar blocks={[{ seconds: 0, rest: false }]} />);
    expect(zero.queryByTestId('workout-step-bar')).toBeNull();
  });
});
