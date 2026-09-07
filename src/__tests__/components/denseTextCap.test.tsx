/**
 * Scenario: the app honours the system text size everywhere and caps it
 * nowhere, so a grid laid out in fixed columns overlaps at 200 per cent rather
 * than reflowing. WCAG 1.4.4 asks for 200 per cent without loss of function,
 * and a dense grid does not meet it today: it fails silently.
 *
 * Expected behaviour: the surfaces that cannot reflow state their limit
 * instead of pretending, and every surface that can take 200 per cent keeps
 * it. So the cap is on the named dense components and on nothing else.
 */

import { execFileSync } from 'node:child_process';

import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { DENSE_TEXT_SCALE, DenseText } from '@/shared/ui/DenseText';
import { StatCard } from '@/features/activity/components/stats/StatCard';

/**
 * The surfaces that cannot reflow, named rather than felt: the stats grids,
 * the metric chip rows, the chart axis labels and the tab bar. A file added
 * here is a claim that its layout breaks at 200 per cent, and a file that
 * reaches for the cap without being here fails this suite.
 */
const DENSE_SURFACES = [
  'src/features/activity/components/stats/StatCard.tsx',
  'src/features/recording/components/DataFieldGrid.tsx',
  'src/shared/charts/CurveChart.tsx',
  'src/features/fitness/components/FitnessChart.tsx',
  'src/features/fitness/components/FormZoneChart.tsx',
  'src/features/insights/components/content/HrvTrendContent.tsx',
  'src/features/insights/components/content/SectionPerformanceTimeline.tsx',
  'src/features/routes/components/section/SectionScatterChart.tsx',
  'src/features/stats/components/FTPTrendChart.tsx',
  'src/shared/ui/BottomTabBar.tsx',
];

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

/** Every `Text` the tree rendered, with the cap it carries. */
function capsOf(tree: ReturnType<typeof render>): (number | undefined)[] {
  return tree
    .UNSAFE_getAllByType(Text)
    .map((node) => node.props.maxFontSizeMultiplier as number | undefined);
}

describe('the dense text cap', () => {
  it('is 1.3, which is what a dense grid can take', () => {
    expect(DENSE_TEXT_SCALE).toBe(1.3);
  });

  it('rides on every DenseText', () => {
    const tree = render(<DenseText>44.2 km</DenseText>);
    expect(capsOf(tree)).toEqual([DENSE_TEXT_SCALE]);
  });

  it('does not stop a caller overriding it deliberately', () => {
    const tree = render(<DenseText maxFontSizeMultiplier={2}>44.2 km</DenseText>);
    expect(capsOf(tree)).toEqual([2]);
  });

  it('caps every line of a stats grid card', () => {
    const tree = render(
      <StatCard
        stat={{
          title: 'Distance',
          value: '44.2 km',
          icon: 'map-marker-distance',
          color: '#000000',
        }}
        isDark={false}
        onPress={() => {}}
      />
    );
    const caps = capsOf(tree);
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.every((cap) => cap === DENSE_TEXT_SCALE)).toBe(true);
  });

  it('reaches exactly the named dense surfaces, and no prose one', () => {
    const users = execFileSync(
      'grep',
      ['-rlE', '--include=*.tsx', '--include=*.ts', 'DenseText|DENSE_TEXT_SCALE', 'src'],
      { encoding: 'utf8' }
    )
      .split('\n')
      .filter(Boolean)
      .filter((f) => !f.startsWith('src/__tests__/'))
      .filter((f) => f !== 'src/shared/ui/DenseText.tsx' && f !== 'src/shared/ui/index.ts')
      .sort();
    expect(users).toEqual([...DENSE_SURFACES].sort());
  });
});
