/**
 * Scenario: an athlete with a 280 W setting and power zones up to 300 W reads
 * the zone chart, the power curve and the eFTP milestone. The zone chart said
 * 'FTP: 280W' over '200-250W' and '300W+', the curve's legend 'FTP 300w', and
 * the milestone 'Cycling eFTP: 252W (+12W)', each written by hand.
 *
 * Expected behaviour: every power value goes through the one formatter, so it
 * reads '280 W' wherever it is, and the strings take the formatted value.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PowerZonesChart } from '@/features/activity/components/PowerZonesChart';
import { PowerCurveChart } from '@/features/stats/components/PowerCurveChart';
import { generateFitnessMilestoneInsights } from '@/features/insights/generators/fitnessMilestone';
import { FitnessMilestoneContent } from '@/features/insights/components/content/FitnessMilestoneContent';
import { initialiseI18n, i18n } from '@/i18n';
import type { PowerCurve } from '@/types';
import type { TFunc } from '@/features/insights/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const mockBands: { secondary?: string }[][] = [];
jest.mock('@/shared/charts', () => ({
  ...jest.requireActual('@/shared/charts'),
  ZoneHistogram: ({ bands }: { bands: { secondary?: string }[] }) => {
    mockBands.push(bands);
    return null;
  },
}));

const mockCurve: { current: PowerCurve } = {
  current: {
    type: 'power',
    sport: 'Ride',
    secs: [5, 60, 300, 1200, 3600],
    watts: [800, 500, 350, 300, 260],
    watts_per_kg: [10, 6.25, 4.375, 3.75, 3.25],
    weight: 80,
  },
};
jest.mock('@/features/stats/hooks/usePowerCurve', () => ({
  usePowerCurve: () => ({ data: mockCurve.current, isLoading: false, error: null }),
}));

function textOf(node: unknown): string[] {
  if (node == null) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(textOf);
  const { children } = node as { children?: unknown[] };
  return (children ?? []).flatMap(textOf);
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

describe('the power zone chart', () => {
  const edges = [0, 150, 200, 250, 300];
  const powerZones = edges.map((minWatts, i) => ({
    zone: i + 1,
    minWatts,
    ...(i + 1 < edges.length ? { maxWatts: edges[i + 1] } : {}),
    seconds: 100,
    percent: 20,
  }));

  it('prints the FTP setting and each zone range with the symbol spaced', () => {
    render(<PowerZonesChart powerZones={powerZones} ftp={280} movingTime={500} />);

    expect(screen.getByText('FTP setting: 280 W')).toBeTruthy();
    expect(mockBands[mockBands.length - 1].map((b) => b.secondary)).toEqual([
      '0-150 W',
      '150-200 W',
      '200-250 W',
      '250-300 W',
      '300+ W',
    ]);
  });
});

describe('the power curve FTP legend', () => {
  it('prints the FTP setting in watts, and in W/kg under the toggle', () => {
    render(<PowerCurveChart ftp={300} />);

    expect(screen.getByTestId('power-curve-ftp-legend')).toHaveTextContent('FTP setting 300 W');

    fireEvent.press(screen.getByTestId('power-curve-unit-per-kg'));
    expect(screen.getByTestId('power-curve-ftp-legend')).toHaveTextContent(
      /^FTP setting 3\.75 W\/kg /
    );
  });
});

describe('the eFTP milestone', () => {
  const NOW = Date.UTC(2026, 8, 20);
  const POWER = {
    latestFtp: 252,
    previousFtp: 240,
    deltaWatts: 12,
    latestDate: NOW / 1000,
    previousDate: NOW / 1000 - 30 * 86_400,
    sampleCount: 31,
  };

  function power(deltaWatts: number) {
    const t = i18n.t.bind(i18n) as unknown as TFunc;
    const trend = { ...POWER, deltaWatts, previousFtp: POWER.latestFtp - deltaWatts };
    const [insight] = generateFitnessMilestoneInsights(trend, null, null, NOW, t);
    if (!insight) throw new Error('no power milestone');
    return insight;
  }

  it('spaces the symbol on the card for a rise and a fall', () => {
    expect(power(12).title).toBe('Cycling eFTP: 252 W (+12 W)');
    expect(power(12).subtitle).toBe('From 240 W to 252 W');
    expect(power(-12).title).toBe('Cycling eFTP: 252 W (−12 W)');
  });

  it('spaces the symbol in the sheet summary', () => {
    const text = textOf(render(<FitnessMilestoneContent insight={power(12)} />).toJSON()).join(' ');

    expect(text).toMatch(/from 240 W on [^.]+ to 252 W on [^.]+\./);
    expect(text).not.toMatch(/\dW\b/);
  });
});
