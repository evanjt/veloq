/**
 * Scenario: the section page opens its laps screen with the range and sport on
 * the page, and the screen lists only the laps inside them under a bare "Laps"
 * header, with its card titled "Laps" a second time.
 *
 * Expected behaviour: a line under the header names the sport and range the
 * list is narrowed to, nothing when neither narrows it, and the card carries no
 * title of its own.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { i18n, initialiseI18n } from '@/i18n';

const mockParams: { id: string; range?: string; sport?: string } = { id: 'section-1' };
const mockPerformance: { sportType: string; sportCounts: { sportType: string; count: number }[] } =
  { sportType: 'Ride', sportCounts: [] };

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { text: '#000', textSecondary: '#888' } }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn(), tapTo: jest.fn() }));

function mockLappedRecord(activityId: string) {
  return {
    activityId,
    activityName: `Morning loop ${activityId}`,
    activityDate: new Date('2026-08-01T00:00:00Z'),
    laps: [0, 40].map((startIndex, i) => ({
      id: `${activityId}-${startIndex}`,
      activityId,
      time: 120 + i * 10,
      pace: 3,
      distance: 300,
      direction: 'same',
      startIndex,
      endIndex: startIndex + 30,
      avgHr: null,
      avgPower: null,
      excluded: false,
      isRecord: false,
    })),
    lapCount: 2,
    bestTime: 120,
    bestPace: 3,
    avgTime: 125,
    avgPace: 3,
    direction: 'same',
  };
}

jest.mock('@/features/routes/hooks/useSectionDetailData', () => ({
  ...jest.requireActual('@/features/routes/hooks/useSectionDetailData'),
  useSectionDetailData: () => ({
    data: { section: { activityPortions: [] }, missingTimeStreamIds: [] },
    status: { kind: 'open' },
  }),
  useSectionDetailPerformance: () => ({
    data: { ...mockPerformance, lapRecords: [mockLappedRecord('a')] },
    error: undefined,
  }),
}));
jest.mock('@/features/routes/hooks/useSectionPerformances', () => ({
  ...jest.requireActual('@/features/routes/hooks/useSectionPerformances'),
  useSectionTimeStreamSync: () => ({
    ready: true,
    error: undefined,
    outstanding: 0,
    refetch: jest.fn(),
  }),
  toPerformanceRecord: (record: unknown) => record,
}));
jest.mock('@/features/routes/hooks/useSectionLaps', () => ({
  ...jest.requireActual('@/features/routes/hooks/useSectionLaps'),
  useSectionLaps: () => ({ excludeLap: jest.fn(), includeLap: jest.fn() }),
}));

const Screen = () => {
  const Laps = require('@/app/section/laps/[id]').default;
  return <Laps />;
};

beforeAll(async () => {
  await initialiseI18n('en-AU');
});

describe('the section laps screen', () => {
  it('names the sport and range it was opened with, and does not title its card again', async () => {
    Object.assign(mockParams, { range: '1m', sport: 'Ride' });
    mockPerformance.sportType = 'Ride';
    mockPerformance.sportCounts = [
      { sportType: 'Ride', count: 4 },
      { sportType: 'Run', count: 2 },
    ];

    const { getByTestId, queryByText } = await render(<Screen />);

    expect(getByTestId('section-laps-scope')).toHaveTextContent(
      `Ride · ${i18n.t('period.long.1m')}`
    );
    expect(getByTestId('section-lap-list')).toBeTruthy();
    expect(queryByText(i18n.t('sections.laps'))).toBeNull();
  });

  it('names nothing when one sport is offered over every date', async () => {
    Object.assign(mockParams, { range: 'all', sport: 'Ride' });
    mockPerformance.sportCounts = [{ sportType: 'Ride', count: 4 }];

    const { queryByTestId, getByTestId } = await render(<Screen />);

    expect(getByTestId('section-lap-list')).toBeTruthy();
    expect(queryByTestId('section-laps-scope')).toBeNull();
  });
});
