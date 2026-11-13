/**
 * Scenario: an athlete taps the info control on the strength balance card.
 *
 * Expected behaviour: the pairs info opens as a sheet route that needs no input, lists every
 * pair the balance compares and the thresholds that flag one, and returns nothing.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import StrengthPairsInfoSheet from '@/app/sheets/strength-pairs-info';
import { StrengthBalanceView } from '@/features/strength/components/StrengthBalanceView';
import { listBalancePairNames } from '@/features/strength/lib/analysis';
import { i18n, initialiseI18n } from '@/i18n';
import type { StrengthBalancePair } from '@/types';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const PAIR: StrengthBalancePair = {
  id: 'push-pull',
  label: 'Push / pull',
  leftSlug: 'chest',
  rightSlug: 'back',
  leftLabel: 'Chest',
  rightLabel: 'Back',
  leftWeightedSets: 12,
  rightWeightedSets: 10,
  dominantSlug: 'chest',
  dominantLabel: 'Chest',
  ratio: 1.2,
  status: 'balanced',
};

beforeAll(async () => {
  await initialiseI18n();
});
beforeEach(() => mockPush.mockClear());

describe('the strength pairs info sheet', () => {
  it('is pushed as a plain route from the info control on the balance card', async () => {
    await render(
      <StrengthBalanceView
        visibleBalancePairs={[PAIR]}
        featuredBalancePair={PAIR}
        periodLabel="4 weeks"
      />
    );
    await fireEvent.press(screen.getByLabelText(i18n.t('strength.pairsInfoTitle')));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/sheets/strength-pairs-info');
    expect(screen.queryByTestId('strength-pairs-info-sheet')).toBeNull();
  });

  it('lists every pair and both threshold lines', async () => {
    await render(<StrengthPairsInfoSheet />);
    const sheet = within(screen.getByTestId('strength-pairs-info-sheet'));
    expect(sheet.getByText(i18n.t('strength.pairsInfoTitle'))).toBeTruthy();
    for (const { label } of listBalancePairNames(i18n.t.bind(i18n) as never)) {
      expect(sheet.getByText(`• ${label}`)).toBeTruthy();
    }
    expect(sheet.getByText(i18n.t('strength.pairsInfoThresholds'))).toBeTruthy();
    expect(sheet.getByText(i18n.t('strength.pairsInfoMinSignal'))).toBeTruthy();
  });
});
