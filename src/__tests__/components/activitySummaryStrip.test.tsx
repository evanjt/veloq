/**
 * Scenario: an activity with no track, an indoor ride or a pool swim, has no
 * map hero, so its screen showed the name in the navigation bar and nothing
 * of the date or the time it took. The hero over the map printed the climb as
 * a bare '120 m' beside the distance and the time.
 *
 * Expected behaviour: the screen without a map shows the date and the stat
 * line under its header, and both carry the climb with a mark saying it is a
 * gain, while the spoken name says it in words.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { ActivitySummaryStrip } from '@/features/activity/components/ActivitySummaryStrip';
import { activityHeroStats } from '@/features/activity/lib/activityHeroStats';
import { initialiseI18n, i18n } from '@/i18n';
import { formatDateTime, formatDuration } from '@/shared/format/format';

import { activityRecord } from '../__shared__/activityRecord';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const indoorRide = activityRecord({
  id: 'indoor-1',
  name: 'Trainer session',
  sportType: 'VirtualRide',
  startDateLocal: '2026-09-05T18:30:00',
  movingTime: 3600,
  distance: 30_000,
  elevationGain: 120,
  streamTypes: ['altitude', 'watts'],
});

const poolSwim = activityRecord({
  ...indoorRide,
  id: 'pool-1',
  sportType: 'Swim',
  distance: 2000,
  elevationGain: 0,
  streamTypes: [],
});

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

describe('the activity screen without a map', () => {
  it('shows the date and the time it took', async () => {
    await render(<ActivitySummaryStrip activity={indoorRide} isMetric isDark={false} />);
    expect(screen.getByText(formatDateTime(indoorRide.startDateLocal ?? ''))).toBeTruthy();
    expect(screen.getByTestId('activity-summary-duration').props.children).toBe(
      formatDuration(3600)
    );
    expect(screen.getByTestId('activity-summary-distance').props.children).toBe('30.0 km');
  });

  it('names each stat for a screen reader, with no arrow in the name', async () => {
    await render(<ActivitySummaryStrip activity={indoorRide} isMetric isDark />);
    const label = screen.getByTestId('activity-summary-stats').props.accessibilityLabel as string;
    expect(label).toBe(
      `Distance: 30.0 km, Duration: ${formatDuration(3600)}, Elevation gain: 120 m`
    );
    expect(label).not.toMatch(/[↑↓]/);
  });

  it('leaves out the climb a pool swim never had', async () => {
    await render(<ActivitySummaryStrip activity={poolSwim} isMetric isDark={false} />);
    expect(screen.queryByTestId('activity-summary-elevation')).toBeNull();
    expect(screen.getByTestId('activity-summary-duration')).toBeTruthy();
  });
});

describe('the climb on the activity hero', () => {
  it('is marked as a gain where it is drawn', () => {
    const [, , gain] = activityHeroStats(indoorRide, true, i18n.t.bind(i18n));
    expect(gain).toEqual({ text: '↑ 120 m', label: 'Elevation gain: 120 m' });
  });

  it('is absent with no climb to print', () => {
    const [, , gain] = activityHeroStats(poolSwim, true, i18n.t.bind(i18n));
    expect(gain).toBeNull();
  });
});
