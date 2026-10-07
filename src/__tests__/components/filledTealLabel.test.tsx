/**
 * Scenario: twenty screens re-implement the filled teal control that
 * `shared/ui/Button` already draws, and painted its label white. White on
 * `colors.primary` measures 3.74:1, under the 4.5:1 text owes, while `Button`
 * itself paints the same fill with `colors.textOnPrimary` at 4.73:1.
 *
 * Expected behaviour: a selected pill carries the dark ink, and the pair drawn
 * on screen clears the bar. The ink was chosen over a darker teal because dark
 * ink on teal-700 measures 3.24:1, which is under the bar again.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { TimeRangeSelector } from '@/features/fitness/components/TimeRangeSelector';
import { TipButtons } from '@/shared/ui/TipButtons';
import { GrantAccessButton } from '@/features/recording/components/GrantAccessButton';
import { SaveErrorBanner } from '@/features/recording/components/SaveErrorBanner';
import { colors } from '@/theme';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/ui/useAnnounceOnAppear', () => ({ useAnnounceOnAppear: () => {} }));

function channels(hex: string): number[] {
  return [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
}

function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = channels(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour a style prop resolves to once the array is flattened. */
function flattened(style: unknown): Record<string, unknown> {
  return (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;
}

it('paints the selected range label in the ink the fill can carry', () => {
  const { getByTestId, getByText } = render(
    <TimeRangeSelector timeRange="3m" onTimeRangeChange={() => {}} isDark={false} />
  );

  const pill = getByTestId('fitness-range-3m');
  const selected = flattened(pill.props.style);
  const label = flattened(getByText('period.short.3m').props.style);

  expect(selected.backgroundColor).toBe(colors.primary);
  expect(label.color).toBe(colors.textOnPrimary);
  expect(contrastRatio(label.color as string, selected.backgroundColor as string)).toBeGreaterThan(
    4.5
  );
});

describe('filled teal controls outside the range selector', () => {
  const fillOf = (node: { props: { style?: unknown } }) =>
    flattened(node.props.style).backgroundColor as string;

  it('draws the tip price and label in the ink the fill can carry', () => {
    const { getByText, getByRole } = render(
      <TipButtons
        products={[{ id: 'tip_small', displayPrice: '$1' }]}
        isPurchasing={false}
        onTip={() => {}}
        isDark={false}
      />
    );
    const fill = fillOf(getByRole('button'));
    for (const node of [getByText('$1'), getByText('support.tipSmall')]) {
      const ink = flattened(node.props.style).color as string;
      expect(fill).toBe(colors.primary);
      expect(contrastRatio(ink, fill)).toBeGreaterThan(4.5);
    }
  });

  it('draws the grant access label on the primary fill in dark ink', () => {
    const { getByText, getByRole } = render(
      <GrantAccessButton onPress={() => {}} loading={false} />
    );
    const fill = fillOf(getByRole('button'));
    const ink = flattened(getByText('recording.grantAccess').props.style).color as string;
    expect(fill).toBe(colors.primary);
    expect(contrastRatio(ink, fill)).toBeGreaterThan(4.5);
  });

  it('draws the retry label on the primary fill in dark ink', () => {
    const { getByText, getByRole } = render(
      <SaveErrorBanner
        errorMessage="failed"
        showPermissionFix={false}
        isOAuthLoading={false}
        onUpgradePermissions={() => {}}
        onRetry={() => {}}
      />
    );
    const fill = fillOf(getByRole('button'));
    const ink = flattened(getByText('common.retry').props.style).color as string;
    expect(fill).toBe(colors.primary);
    expect(contrastRatio(ink, fill)).toBeGreaterThan(4.5);
  });
});
