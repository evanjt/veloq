/**
 * Scenario: Best Efforts on a trailing window called its bests personal records, and the best of
 * seven days is not one. A footnote under the list told the athlete to tap a row, which each
 * row's chevron already shows and which rows with no source activity do not honour.
 *
 * Expected behaviour: a trailing window's subtitle names bests from that window, the whole
 * history keeps "personal records", and no tap-a-row footnote is drawn.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import BestEffortsScreen from '@/app/best-efforts';
import { initialiseI18n } from '@/i18n';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('@/features/activity', () => ({
  useActivityLabels: () => ({ labels: new Map(), error: null }),
}));

let mockParams: { period?: string } = {};
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@/features/stats/hooks/useBestEfforts', () => ({
  useBestEfforts: () => ({
    data: { sports: [], climbing: [] },
    isLoading: false,
    error: null,
    curves: {},
  }),
}));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

describe('the Best Efforts subtitle', () => {
  it('names bests from a trailing window, not personal records', async () => {
    mockParams = { period: '7d' };
    await render(<BestEffortsScreen />);

    expect(screen.getByText('Bests from the last 7 days.')).toBeTruthy();
    expect(screen.queryByText(/record/i)).toBeNull();
  });

  it('keeps personal records for the whole history', async () => {
    mockParams = { period: 'all' };
    await render(<BestEffortsScreen />);

    expect(screen.getByText(/^Personal records/)).toBeTruthy();
  });

  it('draws no tap-a-row footnote', async () => {
    mockParams = { period: '6m' };
    await render(<BestEffortsScreen />);

    expect(screen.queryByText(/tap a row/i)).toBeNull();
  });
});
