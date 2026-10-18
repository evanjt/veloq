/**
 * Scenario: the sheet's data rows coloured a good, caution or concern value
 * from the raw success, warning and error tokens, and its comparison card
 * tinted a concern amber, so a sheet drew the same verdict in a different
 * colour from the card that opened it, in either theme.
 *
 * Expected behaviour: each verdict on the sheet is the ladder's rung for it, in
 * the theme the athlete is in, and the comparison is tinted from the move the
 * generator judged.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { SupportingDataSection } from '@/features/insights/components/SupportingDataSection';
import { DataPointRow } from '@/features/insights/components/DataPointRow';
import type { DataPoint, InsightSupportingData, SupportingTrend } from '@/types';
import { verdictColor, verdictFill } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

const mockTheme = { isDark: false };
jest.mock('@/shared/app', () => ({ useTheme: () => mockTheme }));

type Node = {
  type: { displayName?: string };
  props: { style?: unknown; children?: unknown; color?: unknown };
};

/** Every background an element drew, flattened. */
async function drawn(element: React.ReactElement): Promise<string[]> {
  const { UNSAFE_root } = await render(element);
  return (UNSAFE_root.findAll(() => true) as unknown as Node[])
    .map((n) => StyleSheet.flatten(n.props.style as never) as { backgroundColor?: string } | null)
    .map((style) => style?.backgroundColor)
    .filter((colour): colour is string => typeof colour === 'string');
}

/** The colours of every icon a data row drew. */
async function row(context: DataPoint['context']): Promise<unknown[]> {
  const { UNSAFE_root } = await render(
    <DataPointRow dataPoint={{ label: 'Value', value: 1, context }} />
  );
  return (UNSAFE_root.findAll(() => true) as unknown as Node[])
    .filter((n) => n.type.displayName === 'MaterialCommunityIcons')
    .map((n) => n.props.color);
}

function comparison(trend: SupportingTrend): Promise<string[]> {
  const data: InsightSupportingData = {
    comparisonData: {
      current: { label: 'Now', value: 2 },
      previous: { label: 'Then', value: 1 },
      change: { label: 'Change', value: '+100%' },
    },
    trend,
  };
  return drawn(<SupportingDataSection data={data} category="efficiency_trend" />);
}

describe.each([false, true])('the insight sheet verdicts, dark %s', (isDark) => {
  beforeEach(() => {
    mockTheme.isDark = isDark;
  });

  it.each([
    ['good', 'positive'],
    ['warning', 'caution'],
    ['concern', 'negative'],
  ] as const)('marks a %s value on the %s rung', async (context, rung) => {
    expect(await row(context)).toContain(verdictColor(rung, isDark));
  });

  it.each([
    ['improved', 'positive'],
    ['declined', 'negative'],
  ] as const)('tints a comparison that %s on the %s rung', async (verdict, rung) => {
    expect(await comparison({ direction: 'up', verdict })).toContain(verdictFill(rung, isDark));
  });
});
