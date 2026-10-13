/**
 * Scenario: a Best Efforts row tied to a cached activity is one pressable, so a
 * screen reader speaks its label in place of what the row draws.
 *
 * Expected behaviour: the label carries the duration, the value with its unit,
 * the activity name and its date, the strings the row draws.
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
  useActivityLabels: () => ({
    labels: new Map([
      ['ride-1', { name: 'Lantern Loop', date: '3 March' }],
      ['run-1', { name: 'Harbour Steps', date: '9 April' }],
    ]),
    error: null,
  }),
}));

jest.mock('@/features/stats/hooks/useBestEfforts', () => {
  const { BestEffortKind } = jest.requireActual('../__shared__/veloqrsStub');
  return {
    useBestEfforts: () => ({
      data: {
        sports: [
          {
            sport: 'Ride',
            fetched: true,
            efforts: [
              {
                kind: BestEffortKind.Duration,
                checkpoint: 300,
                value: 312.4,
                activityId: 'ride-1',
              },
            ],
          },
          {
            sport: 'Run',
            fetched: true,
            efforts: [
              {
                kind: BestEffortKind.Distance,
                checkpoint: 5000,
                value: 3.5,
                time: 1428,
                activityId: 'run-1',
              },
            ],
          },
          { sport: 'Swim', fetched: true, efforts: [] },
        ],
        climbing: [],
      },
      isLoading: false,
      error: null,
      curves: {
        Ride: { fetched: true, status: 'idle', retry: jest.fn() },
        Run: { fetched: true, status: 'idle', retry: jest.fn() },
        Swim: { fetched: true, status: 'idle', retry: jest.fn() },
      },
    }),
  };
});

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

describe('a Best Efforts row tied to a cached activity', () => {
  it('speaks the duration, the watts, the activity name and the date', () => {
    render(<BestEffortsScreen />);

    const row = screen.getByTestId('best-efforts-row-Cycling-300');
    expect(row.props.accessibilityLabel).toBe('5 min, 312 W, Lantern Loop, 3 March');
  });

  it('speaks the pace and the elapsed time a run row draws', () => {
    render(<BestEffortsScreen />);

    const label = screen.getByTestId('best-efforts-row-Running-5000').props
      .accessibilityLabel as string;
    expect(label).toMatch(/^5K, \d+:\d{2}\/(km|mi), 23:48, Harbour Steps, 9 April$/);
  });
});
