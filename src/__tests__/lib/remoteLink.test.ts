import {
  createRemoteLink,
  type RelaySocket,
  type RemoteLinkEngine,
} from '@/features/settings/lib/remoteLink';
import { remoteLink } from '@/features/settings/lib/remoteLinkSession';
import { useDebugStore } from '@/features/settings/stores/DebugStore';
import { remote } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
  removeSetting: jest.fn(async () => {}),
}));

const RELAY = 'wss://relay.test/link/';
const ROOM_A = 'room-aaaaaaaaaaaaaaaaaaaaaa';
const ROOM_B = 'room-bbbbbbbbbbbbbbbbbbbbbb';

class FakeSocket implements RelaySocket {
  sent: string[] = [];
  closed = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(message: string) {
    this.sent.push(message);
  }
  close() {
    this.closed = true;
  }
  receive(message: string) {
    this.onmessage?.({ data: message });
  }
  drop() {
    this.closed = true;
    this.onclose?.();
  }
}

function harness(rooms: string[], switchedOn = true) {
  const opened: FakeSocket[] = [];
  const toggle = { on: switchedOn };
  const engine: RemoteLinkEngine & { rooms: string[] } = {
    rooms,
    linkedRooms: jest.fn(() => engine.rooms),
    acceptOffer: jest.fn((offer: string) => {
      if (offer.includes('stranger')) throw new Error('not linked');
      return JSON.stringify({ type: 'answer', sdp: 'v=0 answer' });
    }),
    disconnectAll: jest.fn(),
    connectedCount: jest.fn(() => 0),
  };
  const link = createRemoteLink({
    engine,
    enabled: () => toggle.on,
    relayUrl: RELAY,
    open: (url) => {
      const socket = new FakeSocket(url);
      opened.push(socket);
      return socket;
    },
  });
  const live = () => opened.filter((socket) => !socket.closed);
  return { engine, link, opened, live, toggle };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('remote link', () => {
  it('never reaches the relay while no browser is linked', () => {
    const { link, opened } = harness([]);
    link.foreground();
    jest.advanceTimersByTime(60_000);
    expect(opened).toHaveLength(0);
  });

  it('waits in one room per linked browser while the app is in front', () => {
    const { link, live } = harness([ROOM_A, ROOM_B]);
    link.foreground();
    expect(live().map((socket) => socket.url)).toEqual([RELAY + ROOM_A, RELAY + ROOM_B]);
    link.foreground();
    expect(live()).toHaveLength(2);
  });

  it('closes every room and ends every connection when the app leaves the foreground', () => {
    const { engine, link, live } = harness([ROOM_A]);
    link.foreground();
    link.background();
    expect(live()).toHaveLength(0);
    expect(engine.disconnectAll).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60_000);
    expect(live()).toHaveLength(0);
  });

  it('answers a linked browser and sends nothing to one the engine refuses', () => {
    const { engine, link, live } = harness([ROOM_A]);
    link.foreground();
    const [socket] = live();
    const offer = JSON.stringify({ type: 'offer', sdp: 'v=0 linked' });
    socket.receive(offer);
    expect(engine.acceptOffer).toHaveBeenCalledWith(offer);
    expect(socket.sent).toEqual([JSON.stringify({ type: 'answer', sdp: 'v=0 answer' })]);

    socket.receive(JSON.stringify({ type: 'offer', sdp: 'v=0 stranger' }));
    socket.receive('not json');
    socket.receive(JSON.stringify({ type: 'ice' }));
    expect(socket.sent).toHaveLength(1);
  });

  it('closes the room of a browser that was removed', () => {
    const { engine, link, live } = harness([ROOM_A, ROOM_B]);
    link.foreground();
    engine.rooms = [ROOM_B];
    link.refresh();
    expect(live().map((socket) => socket.url)).toEqual([RELAY + ROOM_B]);
  });

  it('opens the first room once a browser is linked while in front', () => {
    const { engine, link, live } = harness([]);
    link.foreground();
    engine.rooms = [ROOM_A];
    link.refresh();
    expect(live().map((socket) => socket.url)).toEqual([RELAY + ROOM_A]);
  });

  it('rejoins a room the relay closed, only while still in front', () => {
    const { link, live, opened } = harness([ROOM_A]);
    link.foreground();
    live()[0].drop();
    expect(live()).toHaveLength(0);
    jest.advanceTimersByTime(10_000);
    expect(live()).toHaveLength(1);

    live()[0].drop();
    link.background();
    jest.advanceTimersByTime(60_000);
    expect(live()).toHaveLength(0);
    expect(opened).toHaveLength(2);
  });

  it('waits in a pairing room until the pairing ends, even with nothing linked', () => {
    const { link, live } = harness([]);
    link.foreground();
    link.join(ROOM_A);
    expect(live().map((socket) => socket.url)).toEqual([RELAY + ROOM_A]);
    link.leave(ROOM_A);
    expect(live()).toHaveLength(0);
  });

  it('reports the connected count while in front and zero once it leaves', () => {
    const { engine, link } = harness([ROOM_A]);
    const seen: number[] = [];
    link.subscribe((count) => seen.push(count));
    (engine.connectedCount as jest.Mock).mockReturnValue(1);
    link.foreground();
    jest.advanceTimersByTime(5_000);
    expect(seen.at(-1)).toBe(1);
    link.background();
    expect(seen.at(-1)).toBe(0);
    const polls = (engine.connectedCount as jest.Mock).mock.calls.length;
    jest.advanceTimersByTime(60_000);
    expect((engine.connectedCount as jest.Mock).mock.calls.length).toBe(polls);
  });

  it('never reaches the relay while its switch is off, even with a browser linked', () => {
    const { link, opened } = harness([ROOM_A], false);
    link.foreground();
    link.refresh();
    link.join(ROOM_B);
    jest.advanceTimersByTime(60_000);
    expect(opened).toHaveLength(0);
  });

  it('closes every room and ends every connection when the switch turns off', () => {
    const { engine, link, live, toggle } = harness([ROOM_A]);
    link.foreground();
    link.join(ROOM_B);
    expect(live()).toHaveLength(2);
    toggle.on = false;
    link.refresh();
    expect(live()).toHaveLength(0);
    expect(engine.disconnectAll).toHaveBeenCalledTimes(1);
  });
});

describe("the app's remote link", () => {
  const realWebSocket = global.WebSocket;
  afterEach(() => {
    global.WebSocket = realWebSocket;
  });

  it('opens no relay socket at the default switch, even with a browser linked', () => {
    const sockets = jest.fn();
    global.WebSocket = sockets as unknown as typeof WebSocket;
    (remote.linkedRooms as jest.Mock).mockReturnValue([ROOM_A]);
    (remote.listLinkedDevices as jest.Mock).mockReturnValue([{ id: 'a' }]);

    expect(useDebugStore.getState().experimentalFeatures).toEqual({});
    remoteLink.foreground();
    remoteLink.refresh();
    remoteLink.join(ROOM_B);
    jest.advanceTimersByTime(60_000);

    expect(sockets).not.toHaveBeenCalled();
  });
});
