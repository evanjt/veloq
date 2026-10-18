/**
 * Scenario: a pool swim's detail read carries its lengths, rests and
 * per-stroke totals, already shaped by the engine.
 *
 * Expected behaviour: the Lengths tab shows a row per stroke and every length
 * in order with each rest as its own row between the runs, printing the
 * figures the read gives; a read still owed its file shows a pending line and
 * no rows; a swim with no lengths gets no tab at all.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react-native';
import { PoolSwimState, PoolUnit, type PoolSwim } from 'veloqrs';

import {
  PoolLengthsTable,
  showsPoolLengthsTab,
} from '@/features/activity/components/PoolLengthsTable';
import { initialiseI18n } from '@/i18n';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

beforeAll(async () => {
  await initialiseI18n();
});

const active = (
  index: number,
  stroke: number,
  strokeKey: string,
  elapsedSecs: number,
  strokes: number,
  speedMps: number
) => ({
  index,
  active: true,
  stroke,
  strokeKey,
  elapsedSecs,
  strokes,
  speedMps,
  swolf: elapsedSecs + strokes,
});

const read: PoolSwim = {
  state: PoolSwimState.Read,
  poolLengthM: 25,
  poolUnit: PoolUnit.Metres,
  lengths: [
    active(0, 0, 'freestyle', 25, 18, 1),
    active(1, 0, 'freestyle', 25, 20, 1),
    { index: 2, active: false, elapsedSecs: 20 },
    active(3, 2, 'breaststroke', 50, 14, 0.5),
    active(4, 2, 'breaststroke', 40, 15, 0.625),
  ],
  strokeTotals: [
    {
      stroke: 0,
      strokeKey: 'freestyle',
      lengths: 2,
      distanceM: 50,
      elapsedSecs: 50,
      speedMps: 1,
      avgSwolf: 44,
    },
    {
      stroke: 2,
      strokeKey: 'breaststroke',
      lengths: 2,
      distanceM: 50,
      elapsedSecs: 90,
      speedMps: 50 / 90,
      avgSwolf: 59.5,
    },
  ],
};

const owed: PoolSwim = {
  state: PoolSwimState.Owed,
  poolUnit: PoolUnit.Metres,
  lengths: [],
  strokeTotals: [],
};

const settled: PoolSwim = { ...owed, state: PoolSwimState.NoLengths };

function rowText(testID: string): string {
  return within(screen.getByTestId(testID))
    .getAllByText(/./)
    .map((node) => node.props.children)
    .join('|');
}

describe('the lengths of a pool swim', () => {
  it('shows a row per stroke with the totals the read gives', async () => {
    await render(<PoolLengthsTable poolSwim={read} />);

    expect(rowText('pool-stroke-row-0')).toBe('Freestyle|2|50 m|0:50|1:40|44');
    expect(rowText('pool-stroke-row-1')).toBe('Breaststroke|2|50 m|1:30|3:00|59.5');
    expect(screen.queryByTestId('pool-stroke-row-2')).toBeNull();
  });

  it('lists every length in order with the rest as its own row between the runs', async () => {
    await render(<PoolLengthsTable poolSwim={read} />);

    expect(rowText('pool-length-row-0')).toBe('1|Freestyle|0:25|18|1:40|43');
    expect(rowText('pool-length-row-1')).toBe('2|Freestyle|0:25|20|1:40|45');
    expect(rowText('pool-length-row-2')).toBe('Rest|0:20');
    expect(rowText('pool-length-row-3')).toBe('3|Breaststroke|0:50|14|3:20|64');
    expect(rowText('pool-length-row-4')).toBe('4|Breaststroke|0:40|15|2:40|55');
    expect(screen.queryByTestId('pool-length-row-5')).toBeNull();
  });

  it('names the pool length in the header', async () => {
    await render(<PoolLengthsTable poolSwim={read} />);

    expect(screen.getByText('25 m pool')).toBeTruthy();
  });

  it('reads a yard pool in yards and its pace per 100 yards', async () => {
    const yards: PoolSwim = {
      ...read,
      poolLengthM: 22.86,
      poolUnit: PoolUnit.Yards,
      strokeTotals: [{ ...read.strokeTotals[0]!, distanceM: 45.72, speedMps: 0.9144 }],
    };
    await render(<PoolLengthsTable poolSwim={yards} />);

    expect(screen.getByText('25 yd pool')).toBeTruthy();
    expect(rowText('pool-stroke-row-0')).toBe('Freestyle|2|50 yd|0:50|1:40|44');
  });

  it('shows the pending line and no rows while the file is owed', async () => {
    await render(<PoolLengthsTable poolSwim={owed} />);

    expect(screen.getByText('Lengths are being read from the file')).toBeTruthy();
    expect(screen.queryByTestId('pool-stroke-row-0')).toBeNull();
    expect(screen.queryByTestId('pool-length-row-0')).toBeNull();
  });

  it('draws nothing for a swim settled with no lengths', async () => {
    await render(<PoolLengthsTable poolSwim={settled} />);

    expect(screen.toJSON()).toBeNull();
  });
});

describe('whether the detail screen offers a Lengths tab', () => {
  it.each([
    ['read', read, true],
    ['owed its file', owed, true],
    ['settled with no lengths', settled, false],
    ['not a pool swim', null, false],
    ['read with nothing stored', { ...read, lengths: [], strokeTotals: [] }, false],
  ])('for a swim %s', (_name, poolSwim, shown) => {
    expect(showsPoolLengthsTab(poolSwim)).toBe(shown);
  });
});
