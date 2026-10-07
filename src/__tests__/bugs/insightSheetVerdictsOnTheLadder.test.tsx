/**
 * Scenario: the sheet's data rows coloured a good, caution or concern value
 * from the raw success, warning and error tokens, and its comparison card
 * tinted a concern amber, so a sheet drew the same verdict in a different
 * colour from the card that opened it, in either theme.
 *
 * Expected behaviour: each verdict on the sheet is the ladder's rung for it, in
 * the theme the athlete is in.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { SupportingDataSection } from '@/features/insights/components/SupportingDataSection';
import type { DataPoint, InsightSupportingData } from '@/types';
import { verdictColor, verdictFill } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

const mockTheme = { isDark: false };
jest.mock('@/shared/app', () => ({ useTheme: () => mockTheme }));

type Node = { type: unknown; props: { style?: unknown; children?: unknown } };

/** Every background the section drew, flattened. */
function backgrounds(data: InsightSupportingData): string[] {
  const { UNSAFE_root } = render(<SupportingDataSection data={data} />);
  return (UNSAFE_root.findAll(() => true) as unknown as Node[])
    .map((n) => StyleSheet.flatten(n.props.style as never) as { backgroundColor?: string } | null)
    .map((style) => style?.backgroundColor)
    .filter((colour): colour is string => typeof colour === 'string');
}

function row(context: DataPoint['context']): InsightSupportingData {
  return { dataPoints: [{ label: 'Value', value: 1, context }] };
}

function comparison(context: DataPoint['context']): InsightSupportingData {
  return {
    comparisonData: {
      current: { label: 'Now', value: 2 },
      previous: { label: 'Then', value: 1 },
      change: { label: 'Change', value: '+100%', context },
    },
  };
}

describe.each([false, true])('the insight sheet verdicts, dark %s', (isDark) => {
  beforeEach(() => {
    mockTheme.isDark = isDark;
  });

  it.each([
    ['good', 'positive'],
    ['warning', 'caution'],
    ['concern', 'negative'],
  ] as const)('marks a %s value on the %s rung', (context, rung) => {
    expect(backgrounds(row(context))).toContain(verdictColor(rung, isDark));
  });

  it.each([
    ['good', 'positive'],
    ['concern', 'negative'],
  ] as const)('tints a %s comparison on the %s rung', (context, rung) => {
    expect(backgrounds(comparison(context))).toContain(verdictFill(rung, isDark));
  });
});
