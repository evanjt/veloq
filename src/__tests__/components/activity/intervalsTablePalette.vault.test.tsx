/**
 * Scenario: a work interval in zone 6 on rides of several cycling types, and
 * on a run, in both themes.
 * Expected behaviour: the zone label is set in primary text, never in a zone
 * colour, whether or not the interval carries watts.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { IntervalsTable } from '@/features/activity/components/IntervalsTable';
import { colors, darkColors } from '@/theme';
import { zoneColour } from '@/theme/zoneColour';
import type { ActivityInterval, ActivityType } from '@/types';
import { IntervalKind } from 'veloqrs';

function interval(watts?: number): ActivityInterval {
  return {
    id: 1,
    kind: IntervalKind.Work,
    startIndex: 0,
    endIndex: 100,
    distance: 1200,
    movingTime: 180,
    averageSpeed: 6.7,
    averageHeartrate: 150,
    averageWatts: watts,
    zone: 6,
  } as ActivityInterval;
}

async function zoneLabelColour(
  activityType: ActivityType,
  watts?: number,
  isDark = false
): Promise<string | undefined> {
  await render(
    <IntervalsTable
      intervals={[interval(watts)]}
      activityType={activityType}
      isMetric
      isDark={isDark}
    />
  );
  const label = screen.getByText('Z6');
  const style = [label.props.style].flat(Infinity).filter(Boolean) as { color?: string }[];
  return style.reverse().find((s) => s.color)?.color;
}

describe('the intervals table zone palette', () => {
  it.each(['Ride', 'GravelRide', 'MountainBikeRide', 'Handcycle', 'Velomobile', 'VirtualRide'])(
    'sets a %s work interval with watts in primary text',
    async (type) => {
      const colour = await zoneLabelColour(type as ActivityType, 250);
      expect(colour).toBe(colors.textPrimary);
      expect(colour).not.toBe(zoneColour(6, false));
    }
  );

  it('keeps primary text on a ride with no watts at all', async () => {
    expect(await zoneLabelColour('Ride', undefined)).toBe(colors.textPrimary);
  });

  it('sets a run in the dark theme in its primary text', async () => {
    expect(await zoneLabelColour('Run', undefined, true)).toBe(darkColors.textPrimary);
  });
});

describe('the intervals table measure columns', () => {
  it.each([false, true])('sets heart rate and power in primary text, dark %s', async (isDark) => {
    await render(
      <IntervalsTable intervals={[interval(250)]} activityType="Ride" isMetric isDark={isDark} />
    );
    const ink = (isDark ? darkColors : colors).textPrimary;
    for (const value of [/^150/, /^250/]) {
      const cell = screen.getByText(value);
      expect(cell).toHaveStyle({ color: ink });
    }
  });
});
