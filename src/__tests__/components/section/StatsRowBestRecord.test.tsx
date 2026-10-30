/**
 * Scenario: a direction's stats row is handed a best time. The engine says
 * whether that best is the direction's record or only the best of a range, a
 * lone lap or a tie.
 *
 * Expected behaviour: a record draws the trophy beside its time, and any
 * other best reads as "Best" beside the same time with no trophy.
 */

import React from 'react';
import { render, within } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { StatsRow } from '@/features/routes/components/section/StatsRow';

const bestRecord = { bestTime: 240, activityDate: new Date(2026, 8, 1) };

function row(bestIsRecord: boolean) {
  return render(
    <StatsRow
      direction="forward"
      stats={{ avgTime: 245, lastActivity: null, count: 2, avgSpeed: null, outsideBandCount: 0 }}
      bestRecord={bestRecord}
      bestIsRecord={bestIsRecord}
      pointCount={2}
      basis="speed"
      isDark={false}
    />
  );
}

describe('StatsRow best', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('draws the trophy beside a record', async () => {
    const { getByTestId } = await row(true);

    expect(getByTestId('stats-row-trophy-forward')).toBeTruthy();
    expect(getByTestId('stats-row-best-forward').props.children).toBe('4:00');
  });

  it('labels a best that is not a record and draws no trophy', async () => {
    const { getByTestId, queryByTestId } = await row(false);

    expect(queryByTestId('stats-row-trophy-forward')).toBeNull();
    expect(getByTestId('stats-row-best-forward').props.children).toBe('4:00 best');
  });

  it('marks a best timed by projection as estimated, record or not', async () => {
    for (const bestIsRecord of [true, false]) {
      const { getByTestId } = await render(
        <StatsRow
          direction="forward"
          stats={null}
          bestRecord={bestRecord}
          bestIsRecord={bestIsRecord}
          bestEstimated
          pointCount={2}
          basis="speed"
          isDark={false}
        />
      );
      expect(getByTestId('stats-row-best-estimated-forward')).toBeTruthy();
    }
  });

  it('leaves a gate-timed best unmarked', async () => {
    const { queryByTestId } = await row(true);
    expect(queryByTestId('stats-row-best-estimated-forward')).toBeNull();
  });

  it('shows the counted attempts and the omitted distance-band attempts', async () => {
    const { getByTestId } = await render(
      <StatsRow
        direction="forward"
        stats={{ avgTime: 245, lastActivity: null, count: 2, avgSpeed: null, outsideBandCount: 1 }}
        bestRecord={bestRecord}
        bestIsRecord
        pointCount={3}
        basis="speed"
        isDark={false}
      />
    );

    expect(within(getByTestId('stats-row-count-forward')).getByText('2')).toBeTruthy();
    expect(getByTestId('stats-row-outside-band-forward')).toBeTruthy();
  });
});
