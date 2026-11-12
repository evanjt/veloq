/**
 * The phone's side of the link relay.
 *
 * While the app is in front and a browser is linked, the phone waits in that
 * browser's room. A browser's offer goes to the engine, which refuses any
 * browser not linked, and the answer goes back the same way. Nothing else is
 * read or sent here: the data itself flows over the WebRTC channel the engine
 * serves. Leaving the foreground closes every room and ends every connection.
 * While at least one browser is connected the screen is kept awake, and it is
 * released when the last one goes.
 */

/** The relay socket the controller needs, which the platform WebSocket satisfies. */
export interface RelaySocket {
  send(message: string): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

export interface RemoteLinkEngine {
  linkedRooms(): string[];
  acceptOffer(offer: string): string;
  disconnectAll(): void;
  /** Whether the app is in front; the engine answers a browser's write only while it is. */
  setInFront(inFront: boolean): void;
  connectedCount(): number;
}

/** Keeps the screen awake from one `on` call until the matching `off`. */
export interface KeepAwake {
  on(): void;
  off(): void;
}

interface RemoteLinkOptions {
  engine: RemoteLinkEngine;
  /** Whether the remote link is switched on. Off, no room is joined at all. */
  enabled?: () => boolean;
  relayUrl: string;
  open: (url: string) => RelaySocket;
  keepAwake: KeepAwake;
  /** Debug builds only: why an offer was not answered. Never a fingerprint. */
  diagnose?: ((line: string) => void) | undefined;
}

export interface RemoteLinkState {
  /** Browsers connected now. */
  connected: number;
  /** Rooms the phone is open in on the relay, waiting for a browser to join. */
  rooms: number;
}

export interface RemoteLink {
  foreground(): void;
  background(): void;
  /** Reopen the rooms after a browser is linked or removed. */
  refresh(): void;
  /** Wait in a pairing room until `leave`, whether or not anything is linked. */
  join(room: string): void;
  leave(room: string): void;
  /** Called with the connected and open-room counts whenever either changes. */
  subscribe(listener: (state: RemoteLinkState) => void): () => void;
}

const FIRST_RETRY_MS = 5_000;
const LAST_RETRY_MS = 60_000;
const POLL_MS = 2_000;

interface Seat {
  socket: RelaySocket | null;
  retry: ReturnType<typeof setTimeout> | null;
  delay: number;
}

function offerOf(data: unknown): string | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(data);
    const type = (parsed as { type?: unknown } | null)?.type;
    return type === 'offer' ? data : null;
  } catch {
    return null;
  }
}

export function createRemoteLink({
  engine,
  relayUrl,
  open,
  keepAwake,
  enabled = () => true,
  diagnose,
}: RemoteLinkOptions): RemoteLink {
  const seats = new Map<string, Seat>();
  const pairing = new Set<string>();
  const listeners = new Set<(state: RemoteLinkState) => void>();
  let inFront = false;
  let poll: ReturnType<typeof setInterval> | null = null;
  let state: RemoteLinkState = { connected: 0, rooms: 0 };

  const openRooms = () => {
    let open = 0;
    for (const seat of seats.values()) if (seat.socket !== null) open += 1;
    return open;
  };

  const publish = (connected: number) => {
    const rooms = openRooms();
    if (connected === state.connected && rooms === state.rooms) return;
    const before = state.connected;
    state = { connected, rooms };
    if (before === 0 && connected > 0) keepAwake.on();
    else if (before > 0 && connected === 0) keepAwake.off();
    for (const listener of listeners) listener(state);
  };

  const stopPoll = () => {
    if (poll === null) return;
    clearInterval(poll);
    poll = null;
  };

  const tick = () => {
    publish(engine.connectedCount());
    if (seats.size === 0 && state.connected === 0) stopPoll();
  };

  const sit = (room: string, seat: Seat) => {
    const socket = open(relayUrl + room);
    seat.socket = socket;
    publish(state.connected);
    socket.onmessage = ({ data }) => {
      seat.delay = FIRST_RETRY_MS;
      const offer = offerOf(data);
      if (offer === null) return;
      let answer: string;
      try {
        answer = engine.acceptOffer(offer);
      } catch (error) {
        diagnose?.(`offer refused: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      socket.send(answer);
    };
    // The relay ends a room on its own after a while, so a closed room is
    // rejoined for as long as it is still wanted.
    socket.onclose = () => {
      if (seat.socket !== socket) return;
      seat.socket = null;
      publish(state.connected);
      if (!inFront || seats.get(room) !== seat) return;
      seat.retry = setTimeout(() => {
        seat.retry = null;
        if (inFront && seats.get(room) === seat) sit(room, seat);
      }, seat.delay);
      seat.delay = Math.min(seat.delay * 2, LAST_RETRY_MS);
    };
  };

  const unseat = (seat: Seat) => {
    if (seat.retry) clearTimeout(seat.retry);
    const socket = seat.socket;
    seat.socket = null;
    seat.retry = null;
    socket?.close();
  };

  const reconcile = () => {
    const on = inFront && enabled();
    if (inFront && !on && (seats.size > 0 || state.connected > 0)) {
      // Switched off while in front: nothing stays connected behind the switch.
      pairing.clear();
      for (const seat of seats.values()) unseat(seat);
      seats.clear();
      engine.disconnectAll();
      publish(0);
    }
    const wanted = new Set(on ? [...engine.linkedRooms(), ...pairing] : []);
    for (const [room, seat] of seats) {
      if (wanted.has(room)) continue;
      seats.delete(room);
      unseat(seat);
    }
    for (const room of wanted) {
      if (seats.has(room)) continue;
      const seat: Seat = { socket: null, retry: null, delay: FIRST_RETRY_MS };
      seats.set(room, seat);
      sit(room, seat);
    }
    // The count is polled while a room is open, and also while a connection is
    // still counted after its room closed, so the screen is released once it ends.
    if (on && (seats.size > 0 || state.connected > 0)) {
      if (poll === null) poll = setInterval(tick, POLL_MS);
    } else {
      stopPoll();
    }
    publish(state.connected);
  };

  return {
    foreground() {
      inFront = true;
      engine.setInFront(true);
      reconcile();
    },
    background() {
      inFront = false;
      engine.setInFront(false);
      pairing.clear();
      reconcile();
      engine.disconnectAll();
      publish(0);
    },
    refresh: reconcile,
    join(room) {
      pairing.add(room);
      reconcile();
    },
    leave(room) {
      pairing.delete(room);
      reconcile();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
