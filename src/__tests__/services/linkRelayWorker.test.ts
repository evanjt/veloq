/**
 * Expected behaviour: a room request from an address over its limit is
 * refused before the room is reached, and an admitted one is passed to the
 * room. The worker imports `cloudflare:workers`, which only the Workers
 * runtime resolves, so the test stubs it and loads the worker by `require`.
 */

jest.mock('cloudflare:workers', () => ({ DurableObject: class {} }), { virtual: true });

const worker: { fetch(request: Request, env: unknown): Promise<Response> } =
  require('../../../link-relay/src/worker').default;

const ROOM = 'Zm9vYmFyYmF6cXV4cXV1eHh5';
const ADDRESS = '203.0.113.7';

function request(path: string, address?: string): Request {
  const headers: Record<string, string> = {};
  if (address !== undefined) headers['CF-Connecting-IP'] = address;
  return new Request(`https://auth.veloq.fit${path}`, { headers });
}

function env(admitted: boolean) {
  const limited: string[] = [];
  const reached: string[] = [];
  return {
    limited,
    reached,
    LINK_LIMIT: {
      limit: async ({ key }: { key: string }) => {
        limited.push(key);
        return { success: admitted };
      },
    },
    ROOMS: {
      idFromName: (name: string) => name,
      get: (id: string) => ({
        fetch: async () => {
          reached.push(id);
          return new Response('room');
        },
      }),
    },
  };
}

describe('link relay worker', () => {
  it('refuses a room request once the address is over its limit, without reaching the room', async () => {
    const link = env(false);
    const response = await worker.fetch(request(`/link/${ROOM}`, ADDRESS), link);
    expect(response.status).toBe(429);
    expect(link.reached).toEqual([]);
  });

  it('passes an admitted room request to its room', async () => {
    const link = env(true);
    const response = await worker.fetch(request(`/link/${ROOM}`, ADDRESS), link);
    expect(response.status).toBe(200);
    expect(link.reached).toEqual([ROOM]);
  });

  it('limits by the address Cloudflare reports', async () => {
    const link = env(true);
    await worker.fetch(request(`/link/${ROOM}`, ADDRESS), link);
    expect(link.limited).toEqual([ADDRESS]);
  });

  it('keys an unknown address under one fixed name rather than skipping the limit', async () => {
    const link = env(true);
    await worker.fetch(request(`/link/${ROOM}`), link);
    expect(link.limited).toEqual(['unknown']);
  });

  it('answers 404 for a path that is not a room, without spending the limit', async () => {
    const link = env(true);
    const response = await worker.fetch(request('/link/short', ADDRESS), link);
    expect(response.status).toBe(404);
    expect(link.limited).toEqual([]);
    expect(link.reached).toEqual([]);
  });
});
