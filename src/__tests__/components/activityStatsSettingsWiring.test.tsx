/**
 * Scenario: an imperial athlete with a 185 max HR set for rides opens a ride at
 * 30 °C into a 5 m/s wind, and the ride carries no HR zones of its own.
 * Expected behaviour: the stat cards read the athlete's units and settings
 * through `InsightfulStats` itself, not only when a test hands them to the hook,
 * and the heart rate card and the zones chart divide by the one max HR. That
 * max HR is resolved by the activity detail screen read, whose Rust tests pin
 * the precedence, and both surfaces take it as it is handed to them.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { InsightfulStats } from '@/features/activity/components/stats/InsightfulStats';
import { HRZonesChart } from '@/features/activity/components/HRZonesChart';
import { DEFAULT_MAX_HR } from '@/features/activity/lib/hrZones';
import type { Activity, SportSettings } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

let mockIsMetric = true;
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => mockIsMetric,
}));

let mockSportSettings: SportSettings[] | undefined;
jest.mock('@/shared/app/useSportSettings', () => ({
  ...jest.requireActual('@/shared/app/useSportSettings'),
  useSportSettings: () => ({ data: mockSportSettings }),
}));

const ride = {
  id: 'a1',
  type: 'Ride',
  name: 'Ride',
  start_date_local: '2026-09-05T08:00:00',
  average_weather_temp: 30,
  average_wind_speed: 5,
  average_heartrate: 150,
  has_weather: true,
} as Activity;

beforeEach(() => {
  mockIsMetric = true;
  mockSportSettings = undefined;
});

describe('InsightfulStats', () => {
  it('shows the engine impact beside training load and its three signed parts', () => {
    const activity = { ...ride, icu_training_load: 100 } as Activity;
    const impact = { fitness: 100 / 42, fatigue: 100 / 7, form: 100 / 42 - 100 / 7 };
    const card = render(<InsightfulStats activity={activity} fitnessImpact={impact} />);
    expect(card.getByText('activity.stats.trainingLoad')).toBeTruthy();
    fireEvent.press(card.getByText('activity.stats.fitnessImpact'));
    expect(card.getAllByText('+2.4').length).toBeGreaterThan(0);
    expect(card.getByText('+14.3')).toBeTruthy();
    expect(card.getByText('-11.9')).toBeTruthy();
  });

  it('omits the impact when the engine has no load', () => {
    const card = render(<InsightfulStats activity={ride} fitnessImpact={null} />);
    expect(card.queryByText('activity.stats.fitnessImpact')).toBeNull();
  });
  it('reads Fahrenheit and mph for an imperial athlete', () => {
    mockIsMetric = false;
    const { getByText, queryByText } = render(<InsightfulStats activity={ride} />);
    expect(getByText('86°F')).toBeTruthy();
    expect(getByText(/activity\.stats\.windSpeed:\{"speed":"11\.2 mph"\}/)).toBeTruthy();
    expect(queryByText('30°C')).toBeNull();
  });

  it('reads Celsius and km/h for a metric athlete', () => {
    const { getByText } = render(<InsightfulStats activity={ride} />);
    expect(getByText('30°C')).toBeTruthy();
    expect(getByText(/activity\.stats\.windSpeed:\{"speed":"18\.0 km\/h"\}/)).toBeTruthy();
  });

  it('divides the heart rate by the 185 the screen read resolved', () => {
    const { getByText } = render(<InsightfulStats activity={ride} maxHR={185} />);
    expect(getByText('activity.stats.percentOfMaxHR:{"percent":81}')).toBeTruthy();
  });
});

describe('HRZonesChart', () => {
  const hrZones = [{ zone: 1, minBpm: 0, maxBpm: 190, seconds: 60, percent: 100 }];

  it('shows the max HR the heart rate card divides by', () => {
    const { getByText } = render(<HRZonesChart hrZones={hrZones} maxHR={185} />);
    expect(getByText('activity.maxHR:{"value":185}')).toBeTruthy();
    const card = render(<InsightfulStats activity={ride} maxHR={185} />);
    expect(card.getByText('activity.stats.percentOfMaxHR:{"percent":81}')).toBeTruthy();
  });

  it('takes the default with no max HR from the screen read, as the card does', () => {
    const { getByText } = render(<HRZonesChart hrZones={hrZones} />);
    expect(getByText(`activity.maxHR:{"value":${DEFAULT_MAX_HR}}`)).toBeTruthy();
    const card = render(<InsightfulStats activity={ride} />);
    expect(
      card.getByText(
        `activity.stats.percentOfMaxHR:{"percent":${Math.round((150 / DEFAULT_MAX_HR) * 100)}}`
      )
    ).toBeTruthy();
  });
});
