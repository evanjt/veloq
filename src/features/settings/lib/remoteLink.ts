/**
 * The phone's side of the link relay.
 *
 * While the app is in front and a browser is linked, the phone waits in that
 * browser's room. A browser's offer goes to the engine, which refuses any
 * browser not linked, and the answer goes back the same way. Nothing else is
 * read or sent here: the data itself flows over the WebRTC channel the engine
 * serves. Leaving the foreground closes every room and ends every connection.
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
  connectedCount(): number;
}

interface RemoteLinkOptions {
  engine: RemoteLinkEngine;
  /** Whether the remote link is switched on. Off, no room is joined at all. */
  enabled?: () => boolean;
  relayUrl: string;
  open: (url: string) => RelaySocket;
}

export interface RemoteLink {
  foreground(): void;
  background(): void;
  /** Reopen the rooms after a browser is linked or removed. */
  refresh(): void;
  /** Wait in a pairing room until `leave`, whether or not anything is linked. */
  join(room: string): void;
  leave(room: string): void;
  /** Called with the number of connected browsers as it changes. */
  subscribe(listener: (connected: number) => void): () => void;
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
  enabled = () => true,
}: RemoteLinkOptions): RemoteLink {
  const seats = new Map<string, Seat>();
  const pairing = new Set<string>();
  const listeners = new Set<(connected: number) => void>();
  let inFront = false;
  let poll: ReturnType<typeof setInterval> | null = null;
  let connected = 0;

  const report = (count: number) => {
    if (count === connected) return;
    connected = count;
    for (const listener of listeners) listener(count);
  };

  const sit = (room: string, seat: Seat) => {
    const socket = open(relayUrl + room);
    seat.socket = socket;
    socket.onmessage = ({ data }) => {
      seat.delay = FIRST_RETRY_MS;
      const offer = offerOf(data);
      if (offer === null) return;
      let answer: string;
      try {
        answer = engine.acceptOffer(offer);
      } catch {
        return;
      }
      socket.send(answer);
    };
    // The relay ends a room on its own after a while, so a closed room is
    // rejoined for as long as it is still wanted.
    socket.onclose = () => {
      if (seat.socket !== socket) return;
      seat.socket = null;
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
    if (inFront && !on && seats.size > 0) {
      // Switched off while in front: nothing stays connected behind the switch.
      pairing.clear();
      for (const seat of seats.values()) unseat(seat);
      seats.clear();
      engine.disconnectAll();
      report(0);
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
    if (on && seats.size > 0 && poll === null) {
      poll = setInterval(() => report(engine.connectedCount()), POLL_MS);
    } else if ((!on || seats.size === 0) && poll !== null) {
      clearInterval(poll);
      poll = null;
    }
  };

  return {
    foreground() {
      inFront = true;
      reconcile();
    },
    background() {
      inFront = false;
      pairing.clear();
      reconcile();
      engine.disconnectAll();
      report(0);
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
