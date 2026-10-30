/**
 * Scenario: two climbs whose records were set in March at an eFTP of 230 W
 * and in June at 245 W, with the athlete at 262 W now. The group card's
 * subtitle printed the first climb's 230 W as if it held for both, and its
 * sheet drew the first climb's efforts alone, unlabelled, under a bare trace.
 *
 * Expected behaviour: the group names only the value now. The sheet offers a
 * chip per section, and the chip picked drives the map, the numbers and the
 * efforts below it, each the selected section's own.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { StalePrOpportunity } from 'veloqrs';

import { i18n, initialiseI18n } from '@/i18n';
import { navigateTo } from '@/shared/app/navigation';
import type { TFunc } from '@/features/insights/types';
import { generateStalePRInsights } from '@/features/insights/generators/stalePr';
import { StalePRContent } from '@/features/insights/components/content/StalePRContent';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
let mockSection: { id: string } | null = null;
jest.mock('@/shared/native/useSectionDetail', () => ({
  useSectionDetail: (id: string) => ({ section: mockSection && { ...mockSection, id } }),
}));
jest.mock('@/features/routes', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SectionMapView: (props: Record<string, unknown>) => (
      <View testID="section-map-view" {...props} />
    ),
  };
});

const t = i18n.t.bind(i18n) as unknown as TFunc;
const DAY = 86_400;
const NOW_MS = Date.UTC(2026, 9, 1);
// Records set at local noon, so the record day reads the same in every zone.
const MARCH = new Date(2026, 2, 1, 12).getTime() / 1000;
const JUNE = new Date(2026, 5, 1, 12).getTime() / 1000;

function efforts(start: number, times: number[], record: string) {
  return times.map((value, i) => ({
    value,
    date: start + i * 7 * DAY,
    activityId: i === 0 ? record : `${record}-${i}`,
  }));
}

function climb(
  id: string,
  prDate: number,
  previousValue: number,
  times: number[],
  over: Partial<StalePrOpportunity> = {}
): StalePrOpportunity {
  return {
    sectionId: id,
    sectionName: `Climb ${id}`,
    bestTimeSecs: times[0],
    traversalCount: times.length,
    daysSinceLast: 60,
    fitnessMetric: 'power',
    currentValue: 262,
    previousValue,
    gainPercent: Math.round(((262 - previousValue) / previousValue) * 1000) / 10,
    unit: 'W',
    sportType: 'Ride',
    recentEfforts: efforts(prDate, times, `${id}-pr`),
    bestActivityId: `${id}-pr`,
    prDate,
    prPower: 200,
    prSharePercent: Math.round((200 / previousValue) * 100),
    fitnessHistory: [
      { value: previousValue, date: prDate },
      { value: 262, date: NOW_MS / 1000 - DAY },
    ],
    ...over,
  };
}

const MARCH_CLIMB = climb('a', MARCH, 230, [300, 312, 318, 320]);
const JUNE_CLIMB = climb('b', JUNE, 245, [410, 421, 433, 447, 452], {
  prPower: 240,
  prSharePercent: 98,
});

beforeAll(() => initialiseI18n('en-GB'));
beforeEach(() => {
  mockSection = null;
});

describe('a stale-PR group of two power sections', () => {
  it("names the value now and never one section's value on its record day", () => {
    const [group] = generateStalePRInsights([MARCH_CLIMB, JUNE_CLIMB], t, NOW_MS);

    expect(group.subtitle).toBe('Cycling eFTP now 262 W');
    expect(group.subtitle).not.toContain('230');
    expect(group.subtitle).not.toContain('245');
  });

  it("carries each section's own record day, fitness then and record power to its sheet", () => {
    const [group] = generateStalePRInsights([MARCH_CLIMB, JUNE_CLIMB], t, NOW_MS);
    const [march, june] = group.supportingData?.stalePrSections ?? [];

    expect(march.summary).toContain('230 W');
    expect(march.summary).toContain('1 Mar 2026');
    expect(march.effort).toBe('PR power 200 W, 87% of eFTP that day');
    expect(june.summary).toContain('245 W');
    expect(june.summary).toContain('1 Jun 2026');
    expect(june.effort).toBe('PR power 240 W, 98% of eFTP that day');
  });

  it("shows the second section's numbers and efforts once its chip is picked", async () => {
    const [group] = generateStalePRInsights([MARCH_CLIMB, JUNE_CLIMB], t, NOW_MS);
    await render(<StalePRContent insight={group} />);

    expect(screen.getByText(/You set this PR on 1 Mar 2026 at Cycling eFTP 230 W/)).toBeTruthy();
    expect(
      screen.getAllByTestId('insight-series-readout-value').map((n) => n.props.children)
    ).toContain('5:20');

    fireEvent.press(screen.getByTestId('stale-pr-chip-b'));

    expect(screen.getByText(/You set this PR on 1 Jun 2026 at Cycling eFTP 245 W/)).toBeTruthy();
    expect(screen.queryByText(/230 W/)).toBeNull();
    expect(screen.getByText('PR power 240 W, 98% of eFTP that day')).toBeTruthy();
    const readouts = screen
      .getAllByTestId('insight-series-readout-value')
      .map((n) => n.props.children);
    expect(readouts).toContain('7:32');
    expect(readouts).not.toContain('5:20');
  });

  it('opens the selected section on its record, and the record activity', async () => {
    const [group] = generateStalePRInsights([MARCH_CLIMB, JUNE_CLIMB], t, NOW_MS);
    await render(<StalePRContent insight={group} />);
    fireEvent.press(screen.getByTestId('stale-pr-chip-b'));

    fireEvent.press(screen.getByTestId('stale-pr-open-section'));
    expect(navigateTo).toHaveBeenLastCalledWith('/section/b?activityId=b-pr&origin=insights');
    fireEvent.press(screen.getByTestId('stale-pr-open-activity'));
    expect(navigateTo).toHaveBeenLastCalledWith('/activity/b-pr');
  });

  it('draws the selected section on a still basemap that opens it on its record', async () => {
    mockSection = { id: 'any' };
    const [group] = generateStalePRInsights([MARCH_CLIMB, JUNE_CLIMB], t, NOW_MS);
    await render(<StalePRContent insight={group} />);
    fireEvent.press(screen.getByTestId('stale-pr-chip-b'));

    const maps = screen.getAllByTestId('section-map-view');
    expect(maps).toHaveLength(1);
    expect(maps[0].props.section.id).toBe('b');
    expect(maps[0].props.interactive).toBe(false);
    maps[0].props.onPress();
    expect(navigateTo).toHaveBeenLastCalledWith('/section/b?activityId=b-pr&origin=insights');
  });

  it('leaves out the record effort when the engine has none, rather than a dash', async () => {
    const {
      prPower: _power,
      prSharePercent: _share,
      bestActivityId: _activity,
      ...bare
    } = climb('c', MARCH, 230, [300, 312]);
    const [single] = generateStalePRInsights([bare], t, NOW_MS);
    await render(<StalePRContent insight={single} />);

    expect(screen.queryByText(/PR power/)).toBeNull();
    expect(screen.queryByTestId('stale-pr-open-activity')).toBeNull();
    expect(screen.queryByTestId('stale-pr-chip-c')).toBeNull();
  });
});
