/**
 * Scenario: what intervals.icu sends per upload and per re-analysis is only
 * readable from a live tail of the worker, and the worker logged nothing about
 * a delivery. One athlete, named by a worker secret, gets one line per
 * delivery: the receive time, how many events it carried, and for each of that
 * athlete's events its type, timestamp, activity id and activity key names.
 *
 * Expected behaviour: the line never carries the shared secret, another
 * athlete's id, or any activity value but its id, and with no athlete named
 * nothing is logged.
 */

import { webhookShapeLine } from '../../../oauth-proxy/src/webhookShape';

const worker = require('../../../oauth-proxy/src/worker').default as {
  fetch: (request: Request, env: unknown) => Promise<Response>;
};

const RECEIVED_AT = '2026-10-19T08:00:05.000Z';

function harbourDelivery() {
  return {
    secret: 's3cr3t-value',
    events: [
      {
        athlete_id: 'i700',
        type: 'ACTIVITY_UPLOADED',
        timestamp: '2026-10-19T08:00:00Z',
        activity: {
          id: 'a41',
          name: 'Harbour loop',
          distance: 1200,
          icu_sync_date: '2026-10-19T07:59:58Z',
        },
      },
      {
        athlete_id: 'i700',
        type: 'ACTIVITY_ANALYZED',
        timestamp: '2026-10-19T08:00:03Z',
        activity: {
          id: 'a41',
          name: 'Harbour loop',
          distance: 1200,
          icu_sync_date: '2026-10-19T08:00:01Z',
        },
      },
      { athlete_id: 'i800', type: 'WELLNESS_UPDATED', timestamp: '2026-10-19T08:00:04Z' },
    ],
  };
}

function parsed(line: string | null) {
  expect(line).not.toBeNull();
  return JSON.parse((line as string).replace(/^webhook-shape /, ''));
}

describe('the webhook shape line', () => {
  it("records the named athlete's events in delivery order and the delivery's full count", () => {
    const line = webhookShapeLine(harbourDelivery(), RECEIVED_AT, 'i700');

    expect(parsed(line)).toEqual({
      receivedAt: RECEIVED_AT,
      eventCount: 3,
      keys: ['events'],
      events: [
        {
          type: 'ACTIVITY_UPLOADED',
          timestamp: '2026-10-19T08:00:00Z',
          activityId: 'a41',
          activityKeys: ['distance', 'icu_sync_date', 'id', 'name'],
        },
        {
          type: 'ACTIVITY_ANALYZED',
          timestamp: '2026-10-19T08:00:03Z',
          activityId: 'a41',
          activityKeys: ['distance', 'icu_sync_date', 'id', 'name'],
        },
      ],
    });
  });

  it('carries no secret, no activity value but its id, and no other athlete', () => {
    const line = webhookShapeLine(harbourDelivery(), RECEIVED_AT, 'i700') as string;

    expect(line).not.toContain('s3cr3t-value');
    expect(line).not.toContain('secret');
    expect(line).not.toContain('Harbour loop');
    expect(line).not.toContain('1200');
    expect(line).not.toContain('2026-10-19T07:59:58Z');
    expect(line).not.toContain('i800');
    expect(line).not.toContain('i700');
  });

  it('gives an event with no activity no activity keys', () => {
    expect(parsed(webhookShapeLine(harbourDelivery(), RECEIVED_AT, 'i800'))).toEqual({
      receivedAt: RECEIVED_AT,
      eventCount: 3,
      keys: ['events'],
      events: [{ type: 'WELLNESS_UPDATED', timestamp: '2026-10-19T08:00:04Z' }],
    });
  });

  it('matches an athlete id sent as a number', () => {
    const body = { events: [{ athlete_id: 700, type: 'FITNESS_UPDATED' }] };
    expect(parsed(webhookShapeLine(body, RECEIVED_AT, '700')).events).toEqual([
      { type: 'FITNESS_UPDATED' },
    ]);
  });

  it('gives nothing when no athlete is named', () => {
    expect(webhookShapeLine(harbourDelivery(), RECEIVED_AT, undefined)).toBeNull();
    expect(webhookShapeLine(harbourDelivery(), RECEIVED_AT, '')).toBeNull();
  });

  it('gives nothing when the delivery has none of that athlete', () => {
    expect(webhookShapeLine(harbourDelivery(), RECEIVED_AT, 'i900')).toBeNull();
    expect(webhookShapeLine({ secret: 'x', events: [] }, RECEIVED_AT, 'i700')).toBeNull();
    expect(webhookShapeLine({ secret: 'x' }, RECEIVED_AT, 'i700')).toBeNull();
    expect(webhookShapeLine({ events: 'not a list' }, RECEIVED_AT, 'i700')).toBeNull();
    expect(webhookShapeLine(null, RECEIVED_AT, 'i700')).toBeNull();
  });
});

describe('the webhook logging a delivery shape', () => {
  const originalFetch = global.fetch;
  let order: string[];

  function memoryStore() {
    const values = new Map<string, string>();
    return {
      get: jest.fn(async (key: string) => values.get(key) ?? null),
      put: jest.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
      delete: jest.fn(async (key: string) => {
        values.delete(key);
      }),
    };
  }

  function env(shapeAthlete: string | undefined) {
    return {
      WEBHOOK_SECRET: 's3cr3t-value',
      WEBHOOK_SHAPE_ATHLETE: shapeAthlete,
      OAUTH_STATES: memoryStore(),
      DEVICE_TOKENS: {
        get: jest.fn(async (key: string) =>
          key === 'athlete:i700'
            ? [
                {
                  token: 'ExponentPushToken[harbour]',
                  platform: 'android',
                  registeredAt: '2026-09-01',
                },
              ]
            : null
        ),
        put: jest.fn(async () => {}),
        delete: jest.fn(async () => {}),
      },
    };
  }

  function request(body: unknown) {
    return new Request('https://auth.veloq.fit/webhook/intervals', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  function shapeLines() {
    return order.filter((entry) => entry.startsWith('webhook-shape '));
  }

  beforeEach(() => {
    order = [];
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      order.push(args.map(String).join(' '));
    });
    global.fetch = jest.fn(async () => {
      order.push('push');
      return new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('logs one line before any push when the athlete is named', async () => {
    const response = await worker.fetch(request(harbourDelivery()), env('i700'));

    expect(response.status).toBe(200);
    expect(shapeLines()).toHaveLength(1);
    expect(order[0]).toMatch(/^webhook-shape /);
    expect(order).toContain('push');
    const line = parsed(shapeLines()[0]);
    expect(line.eventCount).toBe(3);
    expect(line.events.map((event: { type: string }) => event.type)).toEqual([
      'ACTIVITY_UPLOADED',
      'ACTIVITY_ANALYZED',
    ]);
  });

  it('logs nothing about the delivery when no athlete is named', async () => {
    const response = await worker.fetch(request(harbourDelivery()), env(undefined));

    expect(response.status).toBe(200);
    expect(shapeLines()).toEqual([]);
  });

  it('logs nothing for a delivery with the wrong secret', async () => {
    const response = await worker.fetch(
      request({ ...harbourDelivery(), secret: 'wrong' }),
      env('i700')
    );

    expect(response.status).toBe(401);
    expect(shapeLines()).toEqual([]);
  });
});
