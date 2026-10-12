/**
 * Scenario: Fitness on 1Y links to Best Efforts. The screen read no params and
 * opened on 6M, so the bests it listed were not the bests Fitness had shown.
 *
 * Expected behaviour: the screen opens on the period its link names, asks the
 * engine for that window, and opens on the default for a link that names none
 * or one it does not offer.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import BestEffortsScreen from '@/app/best-efforts';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

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

const mockUseBestEfforts = jest.fn((_days: number, _shown: unknown) => ({
  data: { sports: [], climbing: [] },
  isLoading: false,
  error: null,
  curves: {},
}));
jest.mock('@/features/stats/hooks/useBestEfforts', () => ({
  useBestEfforts: (days: number, shown: unknown) => mockUseBestEfforts(days, shown),
}));

beforeEach(() => {
  mockUseBestEfforts.mockClear();
  mockParams = {};
});

function selected(id: string): boolean | undefined {
  return screen.getByTestId(`best-efforts-range-${id}`).props.accessibilityState?.selected;
}

describe('the period Best Efforts opens on', () => {
  it('is the one its link names', async () => {
    mockParams = { period: '1y' };
    await render(<BestEffortsScreen />);

    expect(selected('1y')).toBe(true);
    expect(selected('6m')).toBe(false);
    expect(mockUseBestEfforts).toHaveBeenLastCalledWith(365, expect.anything());
  });

  it.each([
    ['no period', {}],
    ['an unknown period', { period: '2y' }],
  ])('is the default for a link with %s', async (_name, params) => {
    mockParams = params;
    await render(<BestEffortsScreen />);

    expect(selected('6m')).toBe(true);
    expect(mockUseBestEfforts).toHaveBeenLastCalledWith(180, expect.anything());
  });
});
