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
import { render, renderHook } from '@testing-library/react-native';

import { InsightfulStats } from '@/features/activity/components/stats/InsightfulStats';
import { HRZonesChart } from '@/features/activity/components/HRZonesChart';
import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';

import { MaxHrSource } from 'veloqrs';
import { activityRecord } from '../__shared__/activityRecord';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

let mockIsMetric = true;
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => mockIsMetric,
}));

const ride = activityRecord({
  id: 'a1',
  sportType: 'Ride',
  name: 'Ride',
  startDateLocal: '2026-09-05T08:00:00',
  weatherTemp: 30,
  windSpeed: 5,
  avgHr: 150,
  hasWeather: true,
});

beforeEach(() => {
  mockIsMetric = true;
});

describe('InsightfulStats', () => {
  it('shows the engine impact beside training load', async () => {
    const activity = activityRecord({ ...ride, trainingLoad: 100 });
    const impact = {
      fitness: 100 / 42,
      fatigue: 100 / 7,
      form: 100 / 42 - 100 / 7,
      fitnessDays: 42,
      fatigueDays: 7,
    };
    const card = await render(<InsightfulStats activity={activity} fitnessImpact={impact} />);
    expect(card.getByText('metrics.trainingLoad')).toBeTruthy();
    expect(card.getByText('activity.stats.fitnessImpact')).toBeTruthy();
    expect(card.getAllByText('+2.4').length).toBeGreaterThan(0);
  });

  it('omits the impact when the engine has no load', async () => {
    const card = await render(<InsightfulStats activity={ride} fitnessImpact={null} />);
    expect(card.queryByText('activity.stats.fitnessImpact')).toBeNull();
  });
  it('reads Fahrenheit and mph for an imperial athlete', async () => {
    mockIsMetric = false;
    const { getByText, queryByText } = await render(<InsightfulStats activity={ride} />);
    expect(getByText('86°F')).toBeTruthy();
    expect(getByText(/activity\.stats\.windSpeed:\{"speed":"11\.2 mph"\}/)).toBeTruthy();
    expect(queryByText('30°C')).toBeNull();
  });

  it('reads Celsius and km/h for a metric athlete', async () => {
    const { getByText } = await render(<InsightfulStats activity={ride} />);
    expect(getByText('30°C')).toBeTruthy();
    expect(getByText(/activity\.stats\.windSpeed:\{"speed":"18\.0 km\/h"\}/)).toBeTruthy();
  });

  it('divides the heart rate by the 185 the screen read resolved', async () => {
    const { getByText } = await render(
      <InsightfulStats activity={ride} maxHR={185} maxHrSource={MaxHrSource.SportSettings} />
    );
    expect(getByText('activity.stats.percentOfMaxHR:{"percent":81}')).toBeTruthy();
  });

  it('leaves the percent of max HR out until the screen read answers', async () => {
    const { getByText, queryByText } = await render(<InsightfulStats activity={ride} />);
    expect(getByText('activity.heartRate')).toBeTruthy();
    expect(queryByText(/percentOf/)).toBeNull();
  });
});

describe('the fitness impact explanation', () => {
  const explanation = async (fitnessDays: number, fatigueDays: number) => {
    const activity = activityRecord({ ...ride, trainingLoad: 100 });
    const fitnessImpact = {
      fitness: 100 / fitnessDays,
      fatigue: 100 / fatigueDays,
      form: 100 / fitnessDays - 100 / fatigueDays,
      fitnessDays,
      fatigueDays,
    };
    const { result } = await renderHook(() =>
      useActivityStats({ activity, isMetric: true, fitnessImpact })
    );
    const card = result.current.stats.find((stat) => stat.title === 'activity.stats.fitnessImpact');
    if (!card) throw new Error('no fitness impact card');
    return card.explanation;
  };

  it('states the time constants the athlete set', async () => {
    expect(await explanation(28, 5)).toBe(
      'activity.explanations.fitnessImpact:{"fitnessDays":28,"fatigueDays":5}'
    );
  });

  it('states 42 and 7 when those are the constants in effect', async () => {
    expect(await explanation(42, 7)).toBe(
      'activity.explanations.fitnessImpact:{"fitnessDays":42,"fatigueDays":7}'
    );
  });
});

describe('the heart rate card over a default max HR', () => {
  const runner = activityRecord({ ...ride, sportType: 'Run', avgHr: 170 });
  const heartRateCard = async (maxHR: number, maxHrSource: MaxHrSource) => {
    const { result } = await renderHook(() =>
      useActivityStats({ activity: runner, isMetric: true, maxHR, maxHrSource })
    );
    const card = result.current.stats.find((stat) => stat.title === 'activity.heartRate');
    if (!card) throw new Error('no heart rate card');
    return card;
  };

  it('states a percent of the athlete own max HR as their own', async () => {
    const card = await heartRateCard(205, MaxHrSource.SportSettings);
    expect(card.context).toBe('activity.stats.percentOfMaxHR:{"percent":83}');
    expect((await heartRateCard(185, MaxHrSource.ActivityZones)).context).toBe(
      'activity.stats.percentOfMaxHR:{"percent":92}'
    );
  });

  it('names the default and grades nothing against it', async () => {
    const card = await heartRateCard(190, MaxHrSource.Default);
    expect(card.context).toBe('activity.stats.percentOfDefaultMaxHR:{"percent":89,"value":190}');
    expect(card.stream).toBe('heartrate');
    expect(card.details).toContainEqual({
      label: 'activity.stats.percentOfDefaultMaxHRLabel:{"value":190}',
      value: '89%',
    });
  });
});

describe('HRZonesChart', () => {
  const hrZones = [{ zone: 1, minBpm: 0, maxBpm: 190, seconds: 60, percent: 100, share: 100 }];

  it('shows the max HR the heart rate card divides by, from the sport settings', async () => {
    const { getByText } = await render(
      <HRZonesChart
        hrZones={hrZones}
        maxHR={185}
        maxHrSource={MaxHrSource.SportSettings}
        movingTime={60}
      />
    );
    expect(getByText('activity.zoneMaxFromSettings:{"value":185}')).toBeTruthy();
    const card = await render(
      <InsightfulStats activity={ride} maxHR={185} maxHrSource={MaxHrSource.SportSettings} />
    );
    expect(card.getByText('activity.stats.percentOfMaxHR:{"percent":81}')).toBeTruthy();
  });

  it('names the activity own zones as the source of its max', async () => {
    const { getByText } = await render(
      <HRZonesChart
        hrZones={hrZones}
        maxHR={196}
        maxHrSource={MaxHrSource.ActivityZones}
        movingTime={60}
      />
    );
    expect(getByText('activity.zoneMaxFromActivity:{"value":196}')).toBeTruthy();
  });

  it('says no max HR is set rather than showing the default as the athlete own', async () => {
    const { getByText, queryByText } = await render(
      <HRZonesChart
        hrZones={hrZones}
        maxHR={190}
        maxHrSource={MaxHrSource.Default}
        movingTime={60}
      />
    );
    expect(getByText('activity.zoneMaxDefault:{"value":190}')).toBeTruthy();
    expect(getByText('activity.zoneMaxDefaultHint')).toBeTruthy();
    expect(queryByText(/activity\.maxHR/)).toBeNull();
    expect(queryByText(/zoneMaxFrom/)).toBeNull();
  });

  it('claims no max HR before the screen read answers', async () => {
    const { queryByText } = await render(<HRZonesChart hrZones={hrZones} movingTime={60} />);
    expect(queryByText(/zoneMax|maxHR/)).toBeNull();
  });
});
