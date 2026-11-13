/**
 * Expected behaviour: a room request from an address over its limit is
 * refused before the room is reached, and an admitted one is passed to the
 * room. The worker imports `cloudflare:workers`, which only the Workers
 * runtime resolves, so the test stubs it and loads the worker by `require`.
 */

jest.mock('cloudflare:workers', () => ({ DurableObject: class {} }), { virtual: true });

const relayModule = require('../../../link-relay/src/worker');
const worker: { fetch(request: Request, env: unknown): Promise<Response> } = relayModule.default;
const LinkRoom = relayModule.LinkRoom;

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

const BYE = JSON.stringify({ type: 'bye' });
const PEER = JSON.stringify({ type: 'peer' });
const OFFER = JSON.stringify({ type: 'offer', sdp: 'v=0' });

/** A socket as the room sees it: it records what was sent and what it was closed with. */
class FakeSocket {
  attachment: unknown = undefined;
  readonly sent: string[] = [];
  readonly closed: { code: number; reason: string }[] = [];
  /** A socket the alarm already closed: the runtime throws on a second close. */
  refusesClose = false;
  send(message: string) {
    this.sent.push(message);
  }
  close(code: number, reason: string) {
    if (this.refusesClose) throw new TypeError('WebSocket is already closing');
    this.closed.push({ code, reason });
  }
  serializeAttachment(value: unknown) {
    this.attachment = value;
  }
  deserializeAttachment() {
    return this.attachment;
  }
}

function seated(joined: number): FakeSocket {
  const socket = new FakeSocket();
  socket.serializeAttachment({ sent: 0, joined });
  return socket;
}

function roomWith(present: FakeSocket[]) {
  // Like the runtime, a closed socket stays listed until its close completes.
  const sockets = [...present];
  const room = new LinkRoom();
  Object.assign(room, {
    ctx: {
      getWebSockets: () => [...sockets],
      acceptWebSocket: (socket: FakeSocket) => {
        sockets.push(socket);
      },
      storage: { getAlarm: async () => 1, setAlarm: async () => {} },
    },
  });
  return { room, sockets };
}

function upgrade(): Request {
  return new Request('https://auth.veloq.fit/link/' + ROOM, { headers: { Upgrade: 'websocket' } });
}

const RealResponse = globalThis.Response;

function workers(): { WebSocketPair?: unknown } {
  return globalThis as unknown as { WebSocketPair?: unknown };
}

describe('link relay room object', () => {
  beforeEach(() => {
    // Node's Response refuses status 101, which the Workers runtime returns for an accepted upgrade.
    globalThis.Response = class extends RealResponse {
      constructor(body?: BodyInit | null, init?: ResponseInit) {
        super(body, init?.status === 101 ? { ...init, status: 200 } : init);
      }
    } as typeof Response;
    // The Workers runtime's pair of sockets; the root typings do not declare it.
    workers().WebSocketPair = function WebSocketPair() {
      return [new FakeSocket(), new FakeSocket()];
    };
  });

  afterEach(() => {
    globalThis.Response = RealResponse;
    delete workers().WebSocketPair;
  });

  it('admits a third peer by closing the oldest, telling the rest, then announcing the newcomer', async () => {
    const phone = seated(1);
    const page = seated(2);
    const { room, sockets } = roomWith([phone, page]);

    const response = await room.fetch(upgrade());

    expect(response.status).toBe(200);
    const newcomer = sockets[2];
    expect(phone.closed).toEqual([{ code: 1000, reason: 'Replaced' }]);
    expect(page.sent).toEqual([BYE, PEER]);
    expect(newcomer.sent).toEqual([PEER]);
  });

  it('still admits the newcomer when the oldest socket is already closing', async () => {
    const phone = seated(1);
    phone.refusesClose = true;
    const page = seated(2);
    const { room, sockets } = roomWith([phone, page]);

    const response = await room.fetch(upgrade());

    expect(response.status).toBe(200);
    expect(page.sent).toEqual([BYE, PEER]);
    expect(sockets[2].sent).toEqual([PEER]);
  });

  it('says nothing more when the runtime reports the displaced socket closed', async () => {
    const phone = seated(1);
    const page = seated(2);
    const { room, sockets } = roomWith([phone, page]);
    await room.fetch(upgrade());
    const newcomer = sockets[2];

    room.webSocketClose(phone, 1000);

    expect(page.sent).toEqual([BYE, PEER]);
    expect(newcomer.sent).toEqual([PEER]);
    expect(phone.closed).toHaveLength(1);
  });

  it('relays a setup message to the peers still in the room and never to the displaced one', async () => {
    const phone = seated(1);
    const page = seated(2);
    const { room, sockets } = roomWith([phone, page]);
    await room.fetch(upgrade());
    const newcomer = sockets[2];

    room.webSocketMessage(newcomer, OFFER);

    expect(page.sent).toEqual([BYE, PEER, OFFER]);
    expect(phone.sent).toEqual([]);
    expect(newcomer.deserializeAttachment()).toEqual({ sent: 1, joined: 3 });
  });
});
