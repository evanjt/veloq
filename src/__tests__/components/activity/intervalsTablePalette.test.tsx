/**
 * Scenario: a work interval in zone 6 on rides of several cycling types, and
 * on a run, in both themes.
 * Expected behaviour: the zone label is the zone's text tone, never its fill,
 * whether or not the interval carries watts.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { IntervalsTable } from '@/features/activity/components/IntervalsTable';
import { zoneColour } from '@/theme/zoneColour';
import type { ActivityInterval, ActivityType } from '@/types';

function interval(watts?: number): ActivityInterval {
  return {
    id: 1,
    type: 'WORK',
    start_index: 0,
    end_index: 100,
    distance: 1200,
    moving_time: 180,
    elapsed_time: 180,
    average_speed: 6.7,
    average_heartrate: 150,
    average_watts: watts,
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
    'colours a %s work interval with watts in the zone text tone',
    async (type) => {
      expect(await zoneLabelColour(type as ActivityType, 250)).toBe(zoneColour(6, false, 'text'));
    }
  );

  it('keeps the zone text tone on a ride with no watts at all', async () => {
    expect(await zoneLabelColour('Ride', undefined)).toBe(zoneColour(6, false, 'text'));
  });

  it('colours a run in the zone text tone of the dark theme', async () => {
    expect(await zoneLabelColour('Run', undefined, true)).toBe(zoneColour(6, true, 'text'));
  });
});
