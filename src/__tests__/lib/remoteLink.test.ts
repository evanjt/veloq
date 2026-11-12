import {
  createRemoteLink,
  type RelaySocket,
  type RemoteLinkEngine,
} from '@/features/settings/lib/remoteLink';
import { disconnectRemoteLink, remoteLink } from '@/features/settings/lib/remoteLinkSession';
import { useDebugStore } from '@/features/settings/stores/DebugStore';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { DisconnectReason, remote } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('expo-keep-awake', () => ({
  ...jest.requireActual('expo-keep-awake'),
  activateKeepAwakeAsync: jest.fn(async () => {}),
  deactivateKeepAwake: jest.fn(async () => {}),
}));
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
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(message: string) {
    this.sent.push(message);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  receive(message: string) {
    this.onmessage?.({ data: message });
  }
  drop() {
    this.closed = true;
    this.onclose?.();
  }
}

function harness(rooms: string[], switchedOn = true, diagnose?: (line: string) => void) {
  const opened: FakeSocket[] = [];
  const toggle = { on: switchedOn };
  const keepAwake = { on: jest.fn(), off: jest.fn() };
  const engine: RemoteLinkEngine & { rooms: string[] } = {
    rooms,
    linkedRooms: jest.fn(() => engine.rooms),
    acceptOffer: jest.fn((offer: string) => {
      if (offer.includes('stranger')) throw new Error('not linked');
      return JSON.stringify({ type: 'answer', sdp: 'v=0 answer' });
    }),
    disconnectAll: jest.fn(),
    setInFront: jest.fn(),
    connectedCount: jest.fn(() => 0),
  };
  const link = createRemoteLink({
    engine,
    enabled: () => toggle.on,
    diagnose,
    relayUrl: RELAY,
    open: (url) => {
      const socket = new FakeSocket(url);
      opened.push(socket);
      return socket;
    },
    keepAwake,
  });
  const live = () => opened.filter((socket) => !socket.closed);
  return { engine, keepAwake, link, opened, live, toggle };
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
    expect(engine.disconnectAll).toHaveBeenCalledWith(DisconnectReason.Background);
    jest.advanceTimersByTime(60_000);
    expect(live()).toHaveLength(0);
  });

  it('tells the engine the app has left the front before it ends the connections, and that it is back before a room opens', () => {
    const { engine, link, opened } = harness([ROOM_A]);
    const order: string[] = [];
    (engine.setInFront as jest.Mock).mockImplementation((front: boolean) =>
      order.push(`front:${front}`)
    );
    (engine.disconnectAll as jest.Mock).mockImplementation(() => order.push('disconnect'));
    (engine.linkedRooms as jest.Mock).mockImplementation(() => {
      order.push('rooms');
      return engine.rooms;
    });
    link.foreground();
    link.background();
    expect(order.slice(0, 2)).toEqual(['front:true', 'rooms']);
    expect(order.indexOf('front:false')).toBeLessThan(order.indexOf('disconnect'));
    expect(opened).toHaveLength(1);
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

  it('reports why an offer was refused instead of dropping it silently', () => {
    const lines: string[] = [];
    const { link, live } = harness([ROOM_A], true, (line) => lines.push(line));
    link.foreground();
    live()[0].receive(JSON.stringify({ type: 'offer', sdp: 'v=0 stranger' }));
    expect(lines).toEqual(['offer refused: not linked']);
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

  it('rejoins after the first delay each time the relay closes a room that had opened', () => {
    const { link, live } = harness([ROOM_A]);
    link.foreground();
    for (let cycle = 0; cycle < 3; cycle += 1) {
      live()[0].open();
      live()[0].drop();
      jest.advanceTimersByTime(4_999);
      expect(live()).toHaveLength(0);
      jest.advanceTimersByTime(1);
      expect(live()).toHaveLength(1);
    }
  });

  it('keeps doubling the delay while a room never opens', () => {
    const { link, live } = harness([ROOM_A]);
    link.foreground();
    for (const delay of [5_000, 10_000, 20_000]) {
      live()[0].drop();
      jest.advanceTimersByTime(delay - 1);
      expect(live()).toHaveLength(0);
      jest.advanceTimersByTime(1);
      expect(live()).toHaveLength(1);
    }
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
    link.subscribe(({ connected }) => seen.push(connected));
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

  it('reports the rooms it waits in as each opens, closes and reopens', () => {
    const { link, opened } = harness([ROOM_A]);
    const seen: { connected: number; rooms: number }[] = [];
    link.subscribe((state) => seen.push(state));
    link.foreground();
    expect(seen.at(-1)).toEqual({ connected: 0, rooms: 1 });
    opened[0].drop();
    expect(seen.at(-1)).toEqual({ connected: 0, rooms: 0 });
    jest.advanceTimersByTime(5_000);
    expect(seen.at(-1)).toEqual({ connected: 0, rooms: 1 });
  });

  it('reports no open room once the app leaves the foreground', () => {
    const { link } = harness([ROOM_A]);
    const seen: { connected: number; rooms: number }[] = [];
    link.foreground();
    link.subscribe((state) => seen.push(state));
    link.background();
    expect(seen.at(-1)).toEqual({ connected: 0, rooms: 0 });
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
    expect(engine.disconnectAll).toHaveBeenCalledWith(DisconnectReason.SwitchedOff);
  });

  it('keeps the screen awake from the first connected browser until the last one leaves', () => {
    const { engine, keepAwake, link } = harness([ROOM_A, ROOM_B]);
    const count = engine.connectedCount as jest.Mock;
    link.foreground();

    count.mockReturnValue(1);
    jest.advanceTimersByTime(2_000);
    expect(keepAwake.on).toHaveBeenCalledTimes(1);

    count.mockReturnValue(2);
    jest.advanceTimersByTime(2_000);
    expect(keepAwake.on).toHaveBeenCalledTimes(1);
    expect(keepAwake.off).not.toHaveBeenCalled();

    count.mockReturnValue(0);
    jest.advanceTimersByTime(2_000);
    expect(keepAwake.off).toHaveBeenCalledTimes(1);
    expect(keepAwake.on).toHaveBeenCalledTimes(1);
  });

  it('lets the screen sleep when the app leaves the foreground with a browser connected', () => {
    const { engine, keepAwake, link } = harness([ROOM_A]);
    (engine.connectedCount as jest.Mock).mockReturnValue(1);
    link.foreground();
    jest.advanceTimersByTime(2_000);
    expect(keepAwake.on).toHaveBeenCalledTimes(1);

    link.background();
    expect(keepAwake.off).toHaveBeenCalledTimes(1);
    link.background();
    expect(keepAwake.off).toHaveBeenCalledTimes(1);
  });

  it('lets the screen sleep when the switch turns off with a browser connected', () => {
    const { engine, keepAwake, link, toggle } = harness([ROOM_A]);
    (engine.connectedCount as jest.Mock).mockReturnValue(1);
    link.foreground();
    jest.advanceTimersByTime(2_000);
    expect(keepAwake.on).toHaveBeenCalledTimes(1);

    toggle.on = false;
    link.refresh();
    expect(keepAwake.off).toHaveBeenCalledTimes(1);
  });

  it('holds the screen awake while a connected browser outlives its room closing and reopening', () => {
    const { engine, keepAwake, link, opened } = harness([ROOM_A]);
    (engine.connectedCount as jest.Mock).mockReturnValue(1);
    link.foreground();
    jest.advanceTimersByTime(2_000);
    const seen: { connected: number; rooms: number }[] = [];
    link.subscribe((state) => seen.push(state));

    opened[0].drop();
    expect(seen.at(-1)).toEqual({ connected: 1, rooms: 0 });
    jest.advanceTimersByTime(5_000);
    expect(seen.at(-1)).toEqual({ connected: 1, rooms: 1 });
    expect(keepAwake.on).toHaveBeenCalledTimes(1);
    expect(keepAwake.off).not.toHaveBeenCalled();
  });

  it('lets the screen sleep when the last linked browser is removed while connected', () => {
    const { engine, keepAwake, link } = harness([ROOM_A]);
    const count = engine.connectedCount as jest.Mock;
    count.mockReturnValue(1);
    link.foreground();
    jest.advanceTimersByTime(2_000);
    expect(keepAwake.on).toHaveBeenCalledTimes(1);

    engine.rooms = [];
    link.refresh();
    count.mockReturnValue(0);
    jest.advanceTimersByTime(2_000);
    expect(keepAwake.off).toHaveBeenCalledTimes(1);
  });

  it('never keeps the screen awake while no browser is connected', () => {
    const { keepAwake, link } = harness([ROOM_A]);
    link.foreground();
    jest.advanceTimersByTime(60_000);
    link.background();
    expect(keepAwake.on).not.toHaveBeenCalled();
    expect(keepAwake.off).not.toHaveBeenCalled();
  });
});

describe("the app's remote link", () => {
  it("tells the browser the athlete ended it when the banner's action is used", () => {
    disconnectRemoteLink();
    expect(remote.disconnectAll).toHaveBeenCalledWith(DisconnectReason.Disconnected);
  });

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

  it('keeps the screen awake under the remote link tag while a browser is connected', () => {
    global.WebSocket = jest.fn(() => ({
      send: jest.fn(),
      close: jest.fn(),
    })) as unknown as typeof WebSocket;
    useDebugStore.setState({ experimentalFeatures: { remoteLink: true } });
    (remote.linkedRooms as jest.Mock).mockReturnValue([ROOM_A]);
    (remote.connectedCount as jest.Mock).mockReturnValue(1);

    remoteLink.foreground();
    jest.advanceTimersByTime(2_000);
    expect(activateKeepAwakeAsync).toHaveBeenCalledWith('veloq-remote-link');

    remoteLink.background();
    expect(deactivateKeepAwake).toHaveBeenCalledWith('veloq-remote-link');

    useDebugStore.setState({ experimentalFeatures: {} });
    (remote.linkedRooms as jest.Mock).mockReturnValue([]);
    (remote.connectedCount as jest.Mock).mockReturnValue(0);
  });
});
