/**
 * Scenario: a work interval in zone 6 on rides of several cycling types, and
 * on a run. The heart-rate ladder is the power ladder's first five steps, so
 * zones 1 to 5 look the same from either and only a sixth or seventh zone
 * shows which ladder a row was coloured from.
 * Expected behaviour: every cycling type colours the zone label from the power
 * ladder's sixth step, whether or not the interval carries watts, and a run
 * clamps to the heart-rate ladder's fifth.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { IntervalsTable } from '@/features/activity/components/IntervalsTable';
import { POWER_ZONE_COLORS, HR_ZONE_COLORS } from '@/shared/app/useSportSettings';
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

function zoneLabelColour(activityType: ActivityType, watts?: number): string | undefined {
  render(
    <IntervalsTable
      intervals={[interval(watts)]}
      activityType={activityType}
      isMetric
      isDark={false}
    />
  );
  const label = screen.getByText('Z6');
  const style = [label.props.style].flat(Infinity).filter(Boolean) as { color?: string }[];
  return style.reverse().find((s) => s.color)?.color;
}

describe('the intervals table zone palette', () => {
  it.each(['Ride', 'GravelRide', 'MountainBikeRide', 'Handcycle', 'Velomobile', 'VirtualRide'])(
    'colours a %s work interval with watts from the power ladder',
    (type) => {
      expect(zoneLabelColour(type as ActivityType, 250)).toBe(POWER_ZONE_COLORS[5]);
    }
  );

  it('keeps the power ladder on a ride with no watts at all', () => {
    expect(zoneLabelColour('Ride', undefined)).toBe(POWER_ZONE_COLORS[5]);
  });

  it('colours a run from the heart-rate ladder', () => {
    expect(zoneLabelColour('Run', undefined)).toBe(HR_ZONE_COLORS[4]);
  });
});
