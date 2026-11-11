/**
 * What a link room lets through.
 *
 * A room joins a phone and a browser long enough to swap the offer, the answer
 * and their ICE candidates. Everything else stays out: a third peer, a message
 * of any other type, a binary frame, a message past the size cap, and a peer
 * past its message budget. The relay keeps nothing it forwards.
 */

/** The phone and the browser. */
export const MAX_PEERS = 2;

/** Far above a real offer with its candidates inlined. */
export const MAX_MESSAGE_BYTES = 16 * 1024;

/** Far above a real connection's candidates, so a peer cannot use the room as a pipe. */
export const MAX_MESSAGES_PER_PEER = 256;

/** How long a room stays open after its first peer joins. */
export const ROOM_TTL_MS = 10 * 60 * 1000;

const SETUP_TYPES = new Set(['offer', 'answer', 'ice', 'bye']);

/** An opaque id the two peers derive between them, never an account or a device name. */
const ROOM_ID = /^[A-Za-z0-9_-]{22,128}$/;

export interface Peer {
  send(message: string): void;
}

export type RelayOutcome = 'forwarded' | 'dropped' | 'over budget';

export function isRoomId(id: string): boolean {
  return ROOM_ID.test(id);
}

/** Whether a room holding `present` peers takes another. */
export function admits(present: number): boolean {
  return present < MAX_PEERS;
}

/** The Workers rate limiting binding, which counts per key and holds nothing else. */
export interface AddressLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Whether an address may open another room now. The limit lives in
 * `wrangler.toml`. The limiter keeps a counter per address and no record of
 * when or what it was.
 */
export async function admitsAddress(limiter: AddressLimiter, address: string): Promise<boolean> {
  return (await limiter.limit({ key: address })).success;
}

function isSetupMessage(message: string | ArrayBuffer): message is string {
  if (typeof message !== 'string') return false;
  if (new TextEncoder().encode(message).length > MAX_MESSAGE_BYTES) return false;
  try {
    const parsed: unknown = JSON.parse(message);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
    const type = (parsed as { type?: unknown }).type;
    return typeof type === 'string' && SETUP_TYPES.has(type);
  } catch {
    return false;
  }
}

/**
 * Tell every peer that the room is full, once the second joins. The browser
 * sends its offer on this notice, so neither side has to guess the other is
 * there. Peers never send it themselves: `relay` drops the type.
 */
export function announce(peers: readonly Peer[]): void {
  if (peers.length < MAX_PEERS) return;
  const present = JSON.stringify({ type: 'peer' });
  for (const peer of peers) peer.send(present);
}

/**
 * Pass a message from one peer to the others in its room, when it is a
 * connection setup message and the sender has budget left. `sent` is how many the
 * sender has had forwarded so far.
 */
export function relay(
  from: Peer,
  message: string | ArrayBuffer,
  peers: readonly Peer[],
  sent: number
): RelayOutcome {
  if (sent >= MAX_MESSAGES_PER_PEER) return 'over budget';
  if (!isSetupMessage(message)) return 'dropped';
  for (const peer of peers) {
    if (peer !== from) peer.send(message);
  }
  return 'forwarded';
}
