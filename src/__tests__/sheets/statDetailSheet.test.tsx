/**
 * Scenario: an athlete taps a stat card on the activity screen.
 *
 * Expected behaviour: the stat detail opens as a sheet route that carries the tapped stat as its
 * input, shows that stat's value, title and details, and returns nothing. Swiping it away
 * leaves the activity screen as it was.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { InsightfulStats } from '@/features/activity/components/stats/InsightfulStats';
import StatDetailSheet from '@/app/sheets/stat-detail';
import type { Activity } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { request?: string } = {};

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    canGoBack: () => true,
    back: () => mockBack(),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

const activity = {
  id: 'a1',
  type: 'Ride',
  name: 'Ride',
  start_date_local: '2026-09-05T08:00:00',
  icu_training_load: 100,
} as Activity;
const impact = {
  fitness: 100 / 42,
  fatigue: 100 / 7,
  form: 100 / 42 - 100 / 7,
  fitnessDays: 42,
  fatigueDays: 7,
};

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockParams = {};
});

describe('the stat detail sheet', () => {
  it('opens as a route when a stat card is tapped, without drawing its own overlay', async () => {
    const card = await render(<InsightfulStats activity={activity} fitnessImpact={impact} />);
    expect(mockPush).not.toHaveBeenCalled();
    await fireEvent.press(card.getByText('activity.stats.fitnessImpact'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toMatchObject({ pathname: 'sheets/stat-detail' });
    expect(card.queryByTestId('stat-detail-sheet')).toBeNull();
  });

  it('shows the tapped stat in the route', async () => {
    const card = await render(<InsightfulStats activity={activity} fitnessImpact={impact} />);
    await fireEvent.press(card.getByText('activity.stats.fitnessImpact'));
    mockParams = { request: mockPush.mock.calls.at(-1)[0].params.request };
    await render(<StatDetailSheet />);
    const sheet = within(screen.getByTestId('stat-detail-sheet'));
    expect(sheet.getByText('activity.stats.fitnessImpact')).toBeTruthy();
    expect(sheet.getAllByText('+2.4').length).toBeGreaterThan(0);
    expect(sheet.getByText('+14.3')).toBeTruthy();
    expect(sheet.getByText('-11.9')).toBeTruthy();
  });

  it('shows nothing and goes back when its request is unknown', async () => {
    mockParams = { request: 'sheet-unknown' };
    await render(<StatDetailSheet />);
    expect(screen.queryByTestId('stat-detail-sheet')).toBeNull();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
