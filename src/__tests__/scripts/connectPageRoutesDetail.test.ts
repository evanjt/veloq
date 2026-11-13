/**
 * Scenario: the routes and sections pages draw a selected row's performance
 * chart, attempts table and history from the phone's reads.
 *
 * Expected behaviour: each read has its own slot, so opening another row
 * withdraws the first row's outstanding reads and nothing else; chart points
 * sit by date and speed inside the plot and mark the best; attempts sort by
 * the column pressed and reverse on a second press; history rows name the
 * activities their chips draw, oldest first.
 */

import { createClient, type Channel } from '../../../web/connect/client';
import { isSuperseded } from '../../../web/connect/link';
import {
  ATTEMPT_COLUMNS,
  ROUTE_SLOTS,
  attemptsOf,
  chartPointsOf,
  historyRowsOf,
  performanceAsk,
  pressedAttempts,
  type Attempt,
} from '../../../web/connect/routesDetail';

const attempt = (over: Partial<Attempt>): Attempt => ({
  activityId: 'a',
  name: 'Ride',
  date: 1000,
  speed: 5,
  movingTime: 600,
  isBest: false,
  ...over,
});

describe('the performance ask', () => {
  vaultIt('asks the range in days with no sport and no highlight by default', () => {
    expect(performanceAsk('s1', 365)).toEqual({
      id: 's1',
      timeRangeDays: 365,
      sportFilter: null,
      highlightActivityId: null,
    });
  });
});

describe('the chart points', () => {
  vaultIt('places the earliest date at the left and the fastest speed at the top', () => {
    const points = chartPointsOf(
      [
        { activityId: 'a', activityName: 'A', activityDate: 100, speed: 4, isBest: false },
        { activityId: 'b', activityName: 'B', activityDate: 300, speed: 8, isBest: true },
      ],
      200,
      100
    );
    expect(points).toEqual([
      { id: 'a', name: 'A', x: 0, y: 100, best: false },
      { id: 'b', name: 'B', x: 200, y: 0, best: true },
    ]);
  });

  vaultIt('puts one point, or points of one speed, mid-plot rather than on an edge', () => {
    const [only] = chartPointsOf(
      [{ activityId: 'a', activityName: 'A', activityDate: 5, speed: 3, isBest: false }],
      200,
      100
    );
    expect(only).toMatchObject({ x: 100, y: 50 });
  });

  vaultIt('draws nothing for no points', () => {
    expect(chartPointsOf([], 200, 100)).toEqual([]);
  });

  vaultIt('skips a point whose speed is not a number', () => {
    const points = chartPointsOf(
      [
        { activityId: 'a', activityName: 'A', activityDate: 1, speed: NaN, isBest: false },
        { activityId: 'b', activityName: 'B', activityDate: 2, speed: 2, isBest: false },
      ],
      10,
      10
    );
    expect(points.map((p) => p.id)).toEqual(['b']);
  });
});

describe('the attempts table', () => {
  const rows = [
    attempt({ activityId: 'old', date: 100, movingTime: 500, speed: 6 }),
    attempt({ activityId: 'new', date: 300, movingTime: 700, speed: 4 }),
    attempt({ activityId: 'mid', date: 200, movingTime: 600, speed: 5 }),
  ];
  const ids = (list: Attempt[]) => list.map((row) => row.activityId);

  vaultIt('opens newest first', () => {
    expect(ids(attemptsOf(rows, { column: 'date', descending: true }))).toEqual([
      'new',
      'mid',
      'old',
    ]);
  });

  vaultIt('orders by time and by speed in either direction', () => {
    expect(ids(attemptsOf(rows, { column: 'time', descending: false }))).toEqual([
      'old',
      'mid',
      'new',
    ]);
    expect(ids(attemptsOf(rows, { column: 'speed', descending: true }))).toEqual([
      'old',
      'mid',
      'new',
    ]);
  });

  vaultIt('keeps date order among equal times, and does not reorder its input', () => {
    const tied = [
      attempt({ activityId: 'late', date: 9, movingTime: 1 }),
      attempt({ activityId: 'early', date: 1, movingTime: 1 }),
    ];
    expect(ids(attemptsOf(tied, { column: 'time', descending: true }))).toEqual(['early', 'late']);
    expect(ids(tied)).toEqual(['late', 'early']);
  });

  vaultIt('reverses on the same column and starts a new one in its natural order', () => {
    const start = { column: 'date', descending: true } as const;
    expect(pressedAttempts(start, 'date')).toEqual({ column: 'date', descending: false });
    expect(pressedAttempts(start, 'time')).toEqual({ column: 'time', descending: false });
    expect(pressedAttempts(start, 'speed')).toEqual({ column: 'speed', descending: true });
    expect(ATTEMPT_COLUMNS).toEqual(['date', 'time', 'speed']);
  });
});

describe('the history rows', () => {
  vaultIt('lists the ledger oldest first with the names of the activities it draws', () => {
    const rows = historyRowsOf({
      history: [
        { id: 2, at: '2026-02-01T00:00:00Z', kind: 'recut', details: null, geometryVersion: 2 },
        {
          id: 1,
          at: '2026-01-01T00:00:00Z',
          kind: 'formed',
          details: { around: ['x', 'gone'] } as never,
          geometryVersion: 1,
        },
      ],
      geometryVersions: [
        { version: 1, createdAt: '', milestone: false, pinned: false },
        { version: 2, createdAt: '', milestone: false, pinned: true },
      ],
      pinnedVersion: 2,
      names: [{ activityId: 'x', name: 'Morning loop', date: 5 }],
    });
    expect(rows.map((row) => row.kind)).toEqual(['formed', 'recut']);
    expect(rows[0]?.activities).toEqual(['Morning loop', 'gone']);
    expect(rows[1]).toMatchObject({ version: 2, pinned: true, activities: [] });
  });
});

describe('the read slots', () => {
  vaultIt('gives each read of a detail pane its own slot', () => {
    const slots = Object.values(ROUTE_SLOTS);
    expect(new Set(slots).size).toBe(slots.length);
  });

  vaultIt(
    'withdraws a row’s reads in a slot when another row asks there, and no other',
    async () => {
      const sent: { method: string }[] = [];
      const channel: Channel = {
        readyState: 'open',
        binaryType: 'blob',
        send: (text) => sent.push(JSON.parse(text)),
        onmessage: null,
      };
      const client = createClient(channel);
      const first = client
        .ask('section.detail', { id: 's1' }, ROUTE_SLOTS.sectionDetail)
        .catch((error: unknown) => error);
      const history = client.ask('section.history', { id: 's1' }, ROUTE_SLOTS.sectionHistory);
      void client.ask('section.detail', { id: 's2' }, ROUTE_SLOTS.sectionDetail);
      expect(sent.map((message) => message.method)).toEqual([
        'section.detail',
        'section.history',
        'cancel',
        'section.detail',
      ]);
      expect(isSuperseded(await first)).toBe(true);
      void history.catch(() => undefined);
    }
  );
});
