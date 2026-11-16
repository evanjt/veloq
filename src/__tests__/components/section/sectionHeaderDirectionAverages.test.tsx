/**
 * Scenario: an out-and-back section whose two directions both have laps, on the hero.
 *
 * Expected behaviour: one line under the stats row reads each direction's average in the chart's
 * basis with its direction cue, forward then reverse. One direction draws one figure, and stats
 * not yet read draw no line.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { SectionHeader } from '@/features/routes/components/section/SectionHeader';
import type { FrequentSection } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/features/routes/components/SectionMapView', () => ({
  SectionMapView: () => null,
}));
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useMetricSystem: () => true,
}));

const SECTION: FrequentSection = {
  id: 's1',
  sectionType: 'auto',
  sportTypes: ['Run'],
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
};

const stats = (avgTime: number, avgSpeed: number) => ({ avgTime, avgSpeed, count: 4 }) as never;

function header(props: Record<string, unknown>) {
  return render(
    <SectionHeader
      section={SECTION}
      activityColor="#000000"
      iconName="run"
      activityCount={3}
      customName={null}
      onSaveName={jest.fn()}
      basis="time"
      {...props}
    />
  );
}

describe('section hero direction averages', () => {
  it('reads both directions on one line, forward then reverse', async () => {
    const { getByTestId } = await header({
      forwardStats: stats(600, 2),
      reverseStats: stats(360, 3),
    });
    const line = getByTestId('section-direction-averages');
    expect(getByTestId('section-avg-forward')).toHaveTextContent('10:00');
    expect(getByTestId('section-avg-reverse')).toHaveTextContent('6:00');
    expect(line).toBeTruthy();
    expect(getByTestId('section-avg-forward-cue')).toBeTruthy();
    expect(getByTestId('section-avg-reverse-cue')).toBeTruthy();
  });

  it('reads the average in the pace basis the chart plots', async () => {
    const { getByTestId } = await header({
      basis: 'pace',
      forwardStats: stats(600, 3),
      reverseStats: null,
    });
    expect(getByTestId('section-avg-forward')).toHaveTextContent(/5:33 \/km/);
  });

  it('draws one figure when only one direction has laps', async () => {
    const { getByTestId, queryByTestId } = await header({
      forwardStats: null,
      reverseStats: stats(360, 3),
    });
    expect(getByTestId('section-avg-reverse')).toHaveTextContent('6:00');
    expect(queryByTestId('section-avg-forward')).toBeNull();
  });

  it('draws no line until the stats are read', async () => {
    const { queryByTestId } = await header({ forwardStats: null, reverseStats: null });
    expect(queryByTestId('section-direction-averages')).toBeNull();
  });

  it('draws no line when the stats carry no average', async () => {
    const { queryByTestId } = await header({
      forwardStats: { avgTime: null, count: 0 },
      reverseStats: null,
    });
    expect(queryByTestId('section-direction-averages')).toBeNull();
  });
});
