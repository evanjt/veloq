/**
 * Scenario: the volume split lists antagonist pairs at different ratios.
 *
 * Expected behaviour: a split between two muscles has no better side, so each pair's badge and
 * the featured ratio draw neutral in both themes and name the measured band rather than a
 * verdict.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { StrengthBalanceView } from '@/features/strength/components/StrengthBalanceView';
import { i18n, initialiseI18n } from '@/i18n';
import { verdict } from '@/theme';
import type { StrengthBalancePair } from '@/types';

let mockIsDark = false;
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockIsDark }) }));

function pair(
  id: string,
  left: number,
  right: number,
  status: StrengthBalancePair['status']
): StrengthBalancePair {
  return {
    id,
    label: `${id} pair`,
    leftSlug: `${id}-left`,
    rightSlug: `${id}-right`,
    leftLabel: `${id} left`,
    rightLabel: `${id} right`,
    leftWeightedSets: left,
    rightWeightedSets: right,
    dominantSlug: `${id}-left`,
    dominantLabel: `${id} left`,
    ratio: right > 0 ? left / right : null,
    status,
  };
}

const WIDE = pair('wide', 12, 5, 'imbalanced');
const MIDDLE = pair('middle', 8, 5, 'watch');
const CLOSE = pair('close', 11, 10, 'balanced');
const ONE_SIDED = pair('lone', 6, 0, 'one-sided');
const PAIRS = [WIDE, MIDDLE, CLOSE, ONE_SIDED];

const POLARITY_RUNGS = ['negative', 'caution', 'positive'] as const;

function polarityTones(isDark: boolean): string[] {
  return POLARITY_RUNGS.map((rung) => (isDark ? verdict[rung].dark : verdict[rung].light));
}

function drawnColours(): string[] {
  const nodes = screen.UNSAFE_root.findAll(
    (node) => typeof node.type === 'string' && node.props.style != null
  );
  return nodes.flatMap((node) => {
    const style = StyleSheet.flatten(node.props.style) ?? {};
    return [style.color, style.backgroundColor].filter(
      (value): value is string => typeof value === 'string'
    );
  });
}

beforeAll(async () => {
  await initialiseI18n();
});

describe.each([false, true])('the volume split with isDark=%s', (isDark) => {
  beforeEach(() => {
    mockIsDark = isDark;
  });

  it('draws no pair or featured ratio in a verdict polarity', async () => {
    await render(
      <StrengthBalanceView
        visibleBalancePairs={PAIRS}
        featuredBalancePair={WIDE}
        periodLabel="4 weeks"
      />
    );
    const tones = polarityTones(isDark).map((tone) => tone.toLowerCase());
    for (const colour of drawnColours()) {
      const base = colour.toLowerCase().slice(0, 7);
      expect(tones).not.toContain(base);
    }
  });

  it('names the measured band of each pair instead of a judgement', async () => {
    await render(
      <StrengthBalanceView
        visibleBalancePairs={PAIRS}
        featuredBalancePair={WIDE}
        periodLabel="4 weeks"
      />
    );
    expect(screen.getByText(i18n.t('insights.strengthBalance.bandHigh'))).toBeTruthy();
    expect(screen.getByText(i18n.t('insights.strengthBalance.bandMiddle'))).toBeTruthy();
    expect(screen.getByText(i18n.t('insights.strengthBalance.bandLow'))).toBeTruthy();
    for (const judgement of ['Imbalanced', 'Watch', 'Balanced']) {
      expect(screen.queryByText(judgement)).toBeNull();
    }
  });
});
