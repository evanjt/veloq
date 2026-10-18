/**
 * Scenario: a first load of content whose shape is known (the section's
 * map, a list of bests, the weekly stats grid, the strength body diagram) drew
 * a spinner in a box sized by its padding, so the content pushed everything
 * below it down when it arrived.
 *
 * Expected behaviour: each wait draws a placeholder in the shape of what
 * replaces it, and no spinner.
 */

import React from 'react';
import { ActivityIndicator } from 'react-native';
import { render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SectionDetailMap } from '@/features/routes/components/SectionDetailMap';
import { SeasonBestsSection } from '@/features/fitness/components/SeasonBestsSection';
import { WeeklySummary } from '@/features/stats/components/WeeklySummary';
import { StrengthTab } from '@/features/insights/components/StrengthTab';
import BestEffortsScreen from '@/app/best-efforts';
import type { FrequentSection } from '@/types';
import { WithScreenRead } from '../__shared__/withScreenRead';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@/features/routes/components/SectionMapView', () => ({
  SectionMapView: () => null,
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
// The map waits on the host route's push, which this suite has no navigator to make.
jest.mock('@/shared/async/useAfterNavigationTransition', () => ({
  useAfterNavigationTransition: () => undefined,
}));
jest.mock('@/features/strength/hooks/useStrengthScreenData', () => ({
  ...jest.requireActual('@/features/strength/hooks/useStrengthScreenData'),
  useStrengthScreenData: () => ({
    data: undefined,
    isLoading: true,
    isError: false,
    error: null,
    refetch: jest.fn(),
  }),
  useOwedStrengthFiles: () => ({ status: 'idle', retry: jest.fn() }),
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@/features/stats/hooks/useBestEfforts', () => ({
  useBestEfforts: () => ({
    data: undefined,
    isLoading: true,
    error: null,
    refetch: jest.fn(),
    curves: {
      Ride: { fetched: true, status: 'idle', retry: jest.fn() },
      Run: { fetched: true, status: 'idle', retry: jest.fn() },
      Swim: { fetched: true, status: 'idle', retry: jest.fn() },
    },
  }),
}));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));

const SECTION: FrequentSection = {
  id: 's1',
  sectionType: 'auto',
  sportTypes: ['Ride'],
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 8,
  createdAt: '2026-01-01T00:00:00Z',
};

function withQueries(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

function expectNoSpinner() {
  expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
}

describe('the section map before it mounts', () => {
  it('shimmers over the whole window rather than spinning', async () => {
    await render(withQueries(<SectionDetailMap sectionId={SECTION.id} />));

    const skeleton = screen.getByTestId('section-map-skeleton');
    expect(skeleton).toHaveStyle({ flex: 1 });
    expectNoSpinner();
  });
});

describe('season bests while the read is pending', () => {
  it('draws placeholder rows above the link to every best', async () => {
    await render(<SeasonBestsSection efforts={[]} sport="Cycling" period="3m" isLoading={true} />);

    expect(screen.getByTestId('best-effort-rows-skeleton')).toBeTruthy();
    expect(screen.getByTestId('season-bests-view-all')).toBeTruthy();
    expectNoSpinner();
  });
});

describe('the weekly summary while its totals load', () => {
  it('draws the four-cell stats grid as placeholders', async () => {
    await render(
      withQueries(
        <WithScreenRead>{(training) => <WeeklySummary training={training} />}</WithScreenRead>
      )
    );

    expect(screen.getByTestId('weekly-summary-skeleton')).toBeTruthy();
    expect(
      screen.getAllByTestId('weekly-summary-skeleton-cell', { includeHiddenElements: true })
    ).toHaveLength(4);
    expectNoSpinner();
  });
});

describe('the strength tab on its first read', () => {
  it('draws the body diagram card as a placeholder', async () => {
    await render(<StrengthTab />);

    expect(screen.getByTestId('strength-body-skeleton')).toBeTruthy();
    expectNoSpinner();
  });
});

describe('the Best Efforts screen on its first read', () => {
  it('draws placeholder rows in every sport card and the climbing cards', async () => {
    await render(<BestEffortsScreen />);

    for (const sport of ['Cycling', 'Running', 'Swimming']) {
      const card = screen.getByTestId(`best-efforts-section-${sport}`);
      expect(within(card).getByTestId('best-effort-rows-skeleton')).toBeTruthy();
    }
    expect(
      within(screen.getByTestId('best-efforts-climbing-Cycling')).getByTestId(
        'best-effort-rows-skeleton'
      )
    ).toBeTruthy();
    expectNoSpinner();
  });
});
