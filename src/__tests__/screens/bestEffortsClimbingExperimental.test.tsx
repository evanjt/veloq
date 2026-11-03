/**
 * Scenario: climbing bests are an experimental feature, off by default.
 *
 * Expected behaviour: Best Efforts draws no climbing card while the feature is off, and one per
 * climbing sport with it on.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import BestEffortsScreen from '@/app/best-efforts';
import { initialiseI18n } from '@/i18n';
import { useDebugStore } from '@/features/settings/stores/DebugStore';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useScreenSafeAreaEdges: () => [],
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

beforeEach(() => {
  useDebugStore.setState({ experimentalFeatures: {} });
});

describe('climbing bests on Best Efforts', () => {
  it('draws no climbing card while the feature is off', async () => {
    await render(<BestEffortsScreen />);

    expect(screen.getByTestId('best-efforts-section-Cycling')).toBeTruthy();
    expect(screen.queryByTestId('best-efforts-climbing-Cycling')).toBeNull();
    expect(screen.queryByText('Climbing')).toBeNull();
  });

  it('draws the climbing card with the feature on', async () => {
    useDebugStore.setState({ experimentalFeatures: { climbingBests: true } });
    await render(<BestEffortsScreen />);

    expect(screen.getByTestId('best-efforts-climbing-Cycling')).toBeTruthy();
  });
});
