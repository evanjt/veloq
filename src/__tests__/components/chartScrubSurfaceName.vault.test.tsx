/**
 * Scenario: a screen reader lands on a chart's steppable surface. It is an
 * adjustable control, and with no name of its own it reads as an unnamed
 * slider, or as whatever axis text Android finds inside it.
 *
 * Expected behaviour: every adjustable chart surface is named by the title the
 * card heads it with, and the stepped point stays its value rather than its
 * name.
 */

import React from 'react';
import { fireEvent, render, renderHook, screen } from '@testing-library/react-native';

import { ActivityDotsChart } from '@/features/fitness/components/ActivityDotsChart';
import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { FormZoneChart } from '@/features/fitness/components/FormZoneChart';
import { WellnessTrendsChart } from '@/features/wellness/components/WellnessTrendsChart';
import { CurveChart } from '@/shared/charts';
import { useChartGestures } from '@/shared/charts/useChartGestures';
import { initialiseI18n } from '@/i18n';
import type { FeedCard, WellnessData } from '@/types';
import { dayActivityRow } from '@/features/activity/light';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const DAYS = [
  { id: '2026-04-01', ctl: 40, atl: 48, restingHR: 50, hrv: 61 },
  { id: '2026-04-02', ctl: 41, atl: 49, restingHR: 51 },
  { id: '2026-04-03', ctl: 43, atl: 55, restingHR: 49, hrv: 70 },
] as WellnessData[];

const ACTIVITIES = [
  { id: 'k1', name: 'Kiln walk', sportType: 'Ride', startDateLocal: '2026-04-02T07:00:00' },
] as FeedCard[];

const CURVE = [
  { x: 5, y: 900 },
  { x: 60, y: 450 },
  { x: 300, y: 320 },
];

beforeAll(async () => {
  await initialiseI18n();
});

function surface(name: string) {
  return screen.getByRole('adjustable', { name });
}

describe('an adjustable chart surface carries its chart title as its name', () => {
  it('names the fitness plot by its card title', async () => {
    await render(<FitnessChart data={DAYS} />);
    const plot = surface('Fitness & fatigue');
    expect(plot.props.testID).toBe('fitness-chart-surface');
  });

  it('names the activity strip by its label and keeps the stepped day as the value', async () => {
    await render(<ActivityDotsChart data={DAYS} activities={ACTIVITIES.map(dayActivityRow)} />);
    const strip = surface('Days trained');
    expect(strip.props.testID).toBe('activity-dots-surface');
    expect(strip.props.accessibilityValue).toBeUndefined();

    await fireEvent(strip, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });

    const stepped = surface('Days trained');
    expect(stepped.props.accessibilityValue?.text).toBeTruthy();
    expect(stepped.props.accessibilityValue.text).not.toBe('Days trained');
  });

  it('names the form plot by its header', async () => {
    await render(<FormZoneChart data={DAYS} />);
    expect(surface('Form').props.testID).toBe('form-chart-surface');
  });

  it('names the wellness lanes by their card title', async () => {
    await render(<WellnessTrendsChart data={DAYS} timeRange="7d" smoothingWindow="none" />);
    expect(surface('Wellness trends').props.testID).toBe('wellness-trends-surface');
  });

  it("names a curve chart by its reading's title", async () => {
    await render(
      <CurveChart
        data={CURVE}
        yDomain={[0, 1000]}
        color="#336699"
        xLabels={[]}
        formatY={(v) => `${Math.round(v)} W`}
        reading={{
          title: 'Kiln output',
          xHeader: 'Duration',
          formatX: (x) => `${x} s`,
          shape: 'curve',
        }}
      />
    );
    expect(surface('Kiln output')).toBeTruthy();
  });

  it('returns the label with the adjustable props and none when there is nothing to step', async () => {
    const steppable = await renderHook(() =>
      useChartGestures({ data: [{ x: 0 }, { x: 1 }], accessibilityLabel: 'Kiln heat' })
    );
    expect(steppable.result.current.accessibilityProps.accessibilityLabel).toBe('Kiln heat');

    const empty = await renderHook(() =>
      useChartGestures({ data: [] as { x: number }[], accessibilityLabel: 'Kiln heat' })
    );
    expect(empty.result.current.accessibilityProps).toEqual({});
  });

  it('refuses a scrub hook with no name at compile time', () => {
    const useUnnamedScrub = () =>
      // @ts-expect-error a steppable surface must be given its chart's name
      useChartGestures({ data: [{ x: 0 }] });
    expect(typeof useUnnamedScrub).toBe('function');
  });
});
