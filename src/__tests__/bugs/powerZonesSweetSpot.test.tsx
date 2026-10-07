/**
 * Scenario: the activity carries a Sweet Spot entry beside Z1 to Z7, and it
 * overlaps them.
 *
 * Expected behaviour: the chart shows seven bands whose shares sum to 100.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { PowerZonesChart } from '@/features/activity/components/PowerZonesChart';
import type { ActivityDetail } from '@/types';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/useSportSettings', () => ({
  POWER_ZONE_COLORS: ['#1', '#2', '#3', '#4', '#5', '#6', '#7'],
}));
jest.mock('@/shared/ui', () => ({
  ChartErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockBands: { key: string; percent: number }[][] = [];
jest.mock('@/shared/charts', () => ({
  ZoneHistogram: ({ bands }: { bands: { key: string; percent: number }[] }) => {
    mockBands.push(bands);
    return null;
  },
}));

const activity = {
  icu_power_zones: [150, 200, 250, 300, 350, 400, 999],
  icu_zone_times: [
    { id: 'Z1', secs: 188 },
    { id: 'Z2', secs: 275 },
    { id: 'Z3', secs: 124 },
    { id: 'Z4', secs: 86 },
    { id: 'Z5', secs: 59 },
    { id: 'Z6', secs: 69 },
    { id: 'Z7', secs: 97 },
    { id: 'SS', secs: 80 },
  ],
} as unknown as ActivityDetail;

describe('PowerZonesChart', () => {
  it('renders Z1 to Z7 only, with shares summing to 100', () => {
    render(<PowerZonesChart activity={activity} />);
    const bands = mockBands[mockBands.length - 1];
    expect(bands.map((b) => b.key)).toEqual(['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6', 'Z7']);
    expect(bands.reduce((s, b) => s + b.percent, 0)).toBeCloseTo(100, 6);
    expect(bands[0].percent).toBeCloseTo((188 / 898) * 100, 6);
  });
});
