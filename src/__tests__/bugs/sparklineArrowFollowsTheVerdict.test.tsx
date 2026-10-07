/**
 * Scenario: an efficiency trend whose heart rate times pace runs 820, 805,
 * 790, 781. The card is green and says the heart rate fell, and the sheet
 * under it drew a red falling arrow, a red percentage and a red line, because
 * the sheet compared the first and last points and called any fall bad. A
 * series that moved a tenth of a per cent drew an arrow too.
 *
 * Expected behaviour: the sheet draws the verdict the generator carried. A
 * falling efficiency ratio is the positive rung, a move the generator judged
 * flat is neutral, and a series that carries no verdict is neutral.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import type { EfficiencyTrend } from 'veloqrs';

import { SupportingDataSection } from '@/features/insights/components/SupportingDataSection';
import { generateEfficiencyTrendInsights } from '@/features/insights/generators/efficiencyTrend';
import type { InsightSupportingData } from '@/types';
import { verdictColor } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

const t = (key: string) => key;

const EFFICIENCY = {
  sectionId: 'river',
  sectionName: 'River Loop',
  direction: 0,
  effortCount: 9,
  hrChangeBpm: -4,
  trendSlope: -0.004,
  signalDelta: 1.2,
  points: [820, 805, 790, 781].map((hrPaceRatio, i) => ({ hrPaceRatio, date: i })),
} as unknown as EfficiencyTrend;

const TRENDING = new Set(['trending-up', 'trending-down']);

type Node = { type: { displayName?: string }; props: Record<string, unknown> };

/**
 * The sparkline's glyph, if it drew one, and the colour of its line. The native
 * mocks forward no style props to the host view, so these are read off the
 * icon and the Skia path as the component handed them over.
 */
function drawn(data: InsightSupportingData) {
  const { UNSAFE_root } = render(<SupportingDataSection data={data} />);
  const all = UNSAFE_root.findAll(() => true) as unknown as Node[];
  const glyphs = all.filter(
    (n) => n.type.displayName === 'MaterialCommunityIcons' && TRENDING.has(n.props.name as string)
  );
  const line = all.find((n) => n.type.displayName === 'Path' && n.props.style === 'stroke');
  return {
    glyph: glyphs[0]?.props as { name: string; color: string } | undefined,
    glyphCount: glyphs.length,
    line: line?.props.color as string,
  };
}

describe('the sheet sparkline', () => {
  it('draws a falling efficiency ratio on the positive rung', () => {
    const [efficiency] = generateEfficiencyTrendInsights([EFFICIENCY], 0, t);
    const { glyph, line } = drawn(efficiency.supportingData!);

    expect(line).toBe(verdictColor('positive', false));
    expect(glyph?.color).toBe(verdictColor('positive', false));
    expect(glyph?.name).toBe('trending-up');
  });

  it('carries the engine verdict on the efficiency card, a fall that improved', () => {
    const [efficiency] = generateEfficiencyTrendInsights([EFFICIENCY], 0, t);

    expect(efficiency.supportingData?.trend).toEqual({ direction: 'down', verdict: 'improved' });
  });

  it('draws a move the generator judged flat on the neutral rung, with no arrow', () => {
    const { glyphCount, line } = drawn({
      sparklineData: [100, 100.05, 100.1],
      trend: { direction: 'flat', verdict: 'flat' },
    });

    expect(line).toBe(verdictColor('neutral', false));
    expect(glyphCount).toBe(0);
  });

  it('draws a series that carries no verdict on the neutral rung, with no arrow', () => {
    const { glyphCount, line } = drawn({ sparklineData: [10, 12, 15] });

    expect(line).toBe(verdictColor('neutral', false));
    expect(glyphCount).toBe(0);
  });

  it('draws a move with a direction and no judgement as its bare arrow on the neutral rung', () => {
    const { glyph, line } = drawn({
      sparklineData: [10, 12, 15],
      trend: { direction: 'up', verdict: 'moved' },
    });

    expect(line).toBe(verdictColor('neutral', false));
    expect(glyph).toEqual(
      expect.objectContaining({ name: 'trending-up', color: verdictColor('neutral', false) })
    );
  });
});
