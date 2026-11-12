// The connect page's rules, with no browser API but WebCrypto, so they are
// tested on their own. The engine holds the other half of every derivation
// here, and the two must agree byte for byte.

import type { Methods } from './schema';

/** The longest an invitation lasts. The phone refuses one past two minutes. */
export const INVITATION_TTL_SECS = 110;

/**
 * The protocol version this page is built for. The phone names the one it
 * speaks in its hello, and a page meeting another version asks for nothing.
 */
export const PAGE_PROTOCOL = 3;

/** What the page calls itself in its hello. */
export const PAGE_NAME = 'veloq-connect';

/**
 * The server the page asks for its public address. A STUN server learns only
 * that address, never the data, which stays end to end between the browser
 * and the phone. The phone names the same server.
 */
export const STUN_SERVER = 'stun:stun.cloudflare.com:3478';

/** The peer connection's configuration: the pinned certificate and the STUN server. */
export function peerConfiguration(certificate: RTCCertificate) {
  return { certificates: [certificate], iceServers: [{ urls: STUN_SERVER }] };
}

const FIRST_RETRY_MS = 2_000;
const LAST_RETRY_MS = 30_000;

const encoder = new TextEncoder();

/**
 * The bytes a link answer carries as one base64 string, which is how the
 * engine writes every byte field and each run of floats.
 */
export function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

/** A run of 32-bit floats the engine wrote as its little-endian bytes. */
export function floatsOf(text: string): Float32Array<ArrayBuffer> {
  const bytes = bytesOf(text);
  const view = new DataView(bytes.buffer);
  return Float32Array.from({ length: bytes.length / 4 }, (_, at) => view.getFloat32(at * 4, true));
}

export function base64url(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlBytes(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/** The spelling pins are kept in: the hash in lower case, the hex in upper. */
export function normaliseFingerprint(algorithm: string, value: string): string {
  return `${algorithm.trim().toLowerCase()} ${value.trim().toUpperCase()}`;
}

/**
 * The certificate fingerprint an answer names. The browser's DTLS refuses a
 * connection whose certificate does not match it, so it is the phone's own.
 */
export function answerFingerprint(sdp: string): string | null {
  const [, algorithm, value] = /^a=fingerprint:(\S+) (\S+)\s*$/m.exec(sdp) ?? [];
  return algorithm && value ? normaliseFingerprint(algorithm, value) : null;
}

/**
 * The offer without host candidates hidden behind a generated `.local` name,
 * which the phone does not resolve. It learns the browser's address from the
 * connectivity checks instead.
 */
export function withoutHiddenCandidates(sdp: string): string {
  return sdp
    .split('\r\n')
    .filter((line) => !/^a=candidate:\S+ \d+ \S+ \d+ \S+\.local /i.test(line))
    .join('\r\n');
}

function lengthPrefixed(...parts: string[]): Uint8Array<ArrayBuffer> {
  const chunks = parts.map((part) => encoder.encode(part));
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + 4 + chunk.length, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const chunk of chunks) {
    view.setUint32(at, chunk.length);
    out.set(chunk, at + 4);
    at += 4 + chunk.length;
  }
  return out;
}

/** The room a paired browser and phone meet in: a hash of both fingerprints. */
export async function roomFor(browser: string, phone: string): Promise<string> {
  const prefix = encoder.encode('veloq link room');
  const body = lengthPrefixed(browser, phone);
  const bytes = new Uint8Array(prefix.length + body.length);
  bytes.set(prefix);
  bytes.set(body, prefix.length);
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

/** One side's proof that it holds the secret, over its role and both fingerprints. */
export async function proof(
  secret: Uint8Array<ArrayBuffer>,
  role: 'browser' | 'phone',
  browser: string,
  phone: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, lengthPrefixed(role, browser, phone));
  return base64url(new Uint8Array(mac));
}

export function proofsMatch(given: string, expected: string): boolean {
  const a = base64urlBytes(given);
  const b = base64urlBytes(expected);
  let differ = a.length ^ b.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) differ |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return differ === 0;
}

/** The text the QR code carries. */
export function invitation({
  room,
  secret,
  fp,
  now,
}: {
  room: string;
  secret: Uint8Array;
  fp: string;
  now: number;
}): string {
  return JSON.stringify({
    v: 1,
    room,
    secret: base64url(secret),
    fp,
    exp: now + INVITATION_TTL_SECS,
  });
}

/** How long to wait before the next try after `attempt` failed ones. */
export function retryDelay(attempt: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** Math.min(attempt, 10), LAST_RETRY_MS);
}

export type Invitation = { room: string; secret: Uint8Array<ArrayBuffer>; exp: number };

export type State =
  | { name: 'unpaired'; notice?: 'refused' | 'declined' }
  | { name: 'inviting'; invitation: Invitation; attempt: number; notice?: 'refused' | 'declined' }
  | { name: 'proving'; invitation: Invitation; phone: string }
  | { name: 'confirming'; invitation: Invitation; phone: string }
  | { name: 'waiting'; phone: string; attempt: number }
  | { name: 'connecting'; phone: string; attempt: number }
  | { name: 'connected'; phone: string; attempt: number; methods: string[] | null }
  | { name: 'update'; phone: string };

export type Event =
  | { type: 'start'; phone: string | null }
  | { type: 'invited'; invitation: Invitation }
  | { type: 'peer' }
  | { type: 'answered'; fingerprint: string | null }
  | { type: 'open' }
  | { type: 'proved'; ok: boolean }
  | { type: 'status'; value: string }
  | { type: 'hello'; protocol: number; methods: string[] }
  | { type: 'mismatch' }
  | { type: 'screen'; method: string; params?: object }
  | { type: 'drop' }
  | { type: 'bye' }
  | { type: 'relayClosed' }
  | { type: 'expired' }
  | { type: 'forget' };

export type Effect =
  | { do: 'invite' }
  | { do: 'joinLinked'; phone: string }
  | { do: 'offer' }
  | { do: 'prove' }
  | { do: 'pollStatus' }
  | { do: 'remember'; phone: string }
  | { do: 'leaveRelay' }
  | { do: 'forget' }
  | { do: 'hello' }
  | { do: 'fetchFeed' }
  | { do: 'ask'; method: string; params: object }
  | { do: 'hangUp' }
  | { do: 'retry'; delay: number }
  | { do: 'rejoin'; room: string; delay: number };

export type Step = { state: State; effects: Effect[] };

const to = (state: State, effects: Effect[] = []): Step => ({ state, effects });

/** The states before the data channel opens, where the relay is the only route. */
const SETUP_STATES = new Set<string>(['inviting', 'waiting', 'connecting']);

/** Start pairing again, after a refusal or with nothing paired. */
const afresh = (notice?: 'refused' | 'declined'): Step =>
  to(notice ? { name: 'unpaired', notice } : { name: 'unpaired' }, [
    { do: 'hangUp' },
    { do: 'invite' },
  ]);

/**
 * One step of the page: the next state and what to do about it. Fetched
 * screen data is not here: app.ts keeps it per connection and clears it on a drop.
 */
export function step(state: State, event: Event): Step {
  if (event.type === 'start') {
    if (event.phone === null) return to({ name: 'unpaired' }, [{ do: 'invite' }]);
    return to({ name: 'waiting', phone: event.phone, attempt: 0 }, [
      { do: 'joinLinked', phone: event.phone },
    ]);
  }
  if (event.type === 'forget') {
    return to({ name: 'unpaired' }, [{ do: 'hangUp' }, { do: 'forget' }, { do: 'invite' }]);
  }
  if (event.type === 'bye') {
    // The relay reports the phone leaving its room. Until the data channel opens
    // the room is the only route to the phone, so a bye there is a drop. After
    // that the relay has no say: a real loss arrives as the channel closing or
    // the peer connection failing.
    return SETUP_STATES.has(state.name) ? step(state, { type: 'drop' }) : to(state);
  }
  // A reply the page cannot read means the phone speaks another format, so the
  // connection is closed and the athlete is told to update, as for a hello on
  // another protocol. Before a phone is paired there is none, so it is ignored.
  if (event.type === 'mismatch' && 'phone' in state && state.name !== 'update') {
    return update(state.phone);
  }

  switch (state.name) {
    case 'unpaired':
      if (event.type === 'invited') {
        // The new code starts at once, so the reason the last one ended is
        // carried onto it to be read there.
        const inviting: State = { name: 'inviting', invitation: event.invitation, attempt: 0 };
        return to(state.notice ? { ...inviting, notice: state.notice } : inviting);
      }
      return to(state);

    case 'inviting':
      if (event.type === 'peer') return to(state, [{ do: 'offer' }]);
      // The relay going away is not the phone going away: the code on screen
      // stays good until it expires, so its room is tried again.
      if (event.type === 'relayClosed') {
        return to({ ...state, attempt: state.attempt + 1 }, [
          { do: 'rejoin', room: state.invitation.room, delay: retryDelay(state.attempt) },
        ]);
      }
      if (event.type === 'answered' && event.fingerprint) {
        return to({ name: 'proving', invitation: state.invitation, phone: event.fingerprint });
      }
      if (event.type === 'expired' || event.type === 'drop') return afresh();
      return to(state);

    case 'proving':
      if (event.type === 'open') return to(state, [{ do: 'prove' }]);
      if (event.type === 'proved') {
        if (!event.ok) return afresh('refused');
        return to({ ...state, name: 'confirming' }, [{ do: 'pollStatus' }]);
      }
      if (event.type === 'drop' || event.type === 'expired') return afresh();
      return to(state);

    case 'confirming':
      if (event.type === 'status') {
        if (event.value === 'confirmed') {
          return to(opened(state.phone), [
            { do: 'leaveRelay' },
            { do: 'remember', phone: state.phone },
            { do: 'hello' },
          ]);
        }
        if (event.value === 'waiting') return to(state, [{ do: 'pollStatus' }]);
        return afresh(event.value === 'declined' ? 'declined' : 'refused');
      }
      if (event.type === 'drop') return afresh();
      return to(state);

    case 'waiting':
      if (event.type === 'peer') return to({ ...state, name: 'connecting' }, [{ do: 'offer' }]);
      if (event.type === 'relayClosed') {
        return to({ ...state, attempt: state.attempt + 1 }, [
          { do: 'retry', delay: retryDelay(state.attempt) },
        ]);
      }
      if (event.type === 'drop') {
        return to({ ...state, attempt: state.attempt + 1 }, [
          { do: 'hangUp' },
          { do: 'retry', delay: retryDelay(state.attempt) },
        ]);
      }
      return to(state);

    case 'connecting':
      if (event.type === 'answered') {
        if (event.fingerprint !== state.phone) {
          return to({ name: 'unpaired', notice: 'refused' }, [
            { do: 'hangUp' },
            { do: 'forget' },
            { do: 'invite' },
          ]);
        }
        return to(state);
      }
      if (event.type === 'open') {
        // The channel carries everything from here, so the relay room is left
        // and the phone's seat in it is free for another browser.
        return to(opened(state.phone), [{ do: 'leaveRelay' }, { do: 'hello' }]);
      }
      if (event.type === 'drop') return dropped(state.phone, state.attempt);
      return to(state);

    case 'connected':
      if (event.type === 'hello') {
        // Methods are additive within a protocol version, so a phone on the
        // same version that lacks one is older than this page, not different.
        if (event.protocol !== PAGE_PROTOCOL) return update(state.phone);
        return step({ ...state, methods: event.methods }, { type: 'screen', method: 'feed.page' });
      }
      if (event.type === 'screen') {
        if (!state.methods?.includes(event.method)) return update(state.phone);
        return to(
          state,
          event.method === 'feed.page'
            ? [{ do: 'fetchFeed' }]
            : [{ do: 'ask', method: event.method, params: event.params ?? {} }]
        );
      }
      if (event.type === 'drop') return dropped(state.phone, state.attempt);
      return to(state);

    default:
      return to(state);
  }
}

/** The data channel just opened: nothing is known of what the phone speaks. */
const opened = (phone: string): State => ({ name: 'connected', phone, attempt: 0, methods: null });

/**
 * The phone and the page do not speak the same protocol, or the phone lacks a
 * method the page needs: the connection is closed and the athlete is told to
 * update Veloq on the phone. Unlinking is the only way out of it.
 */
function update(phone: string): Step {
  return to({ name: 'update', phone }, [{ do: 'hangUp' }]);
}

function dropped(phone: string, attempt: number): Step {
  return to({ name: 'waiting', phone, attempt: attempt + 1 }, [
    { do: 'hangUp' },
    { do: 'retry', delay: retryDelay(attempt) },
  ]);
}

/** A reply from the phone: its id and either a result or an error. */
export interface Reply {
  id: number;
  result?: unknown;
  error?: unknown;
}

/**
 * The raw size limit of one message on the data channel, header included. It
 * is the engine's `FRAME_BYTES` in `remote/protocol.rs`, which names the
 * browsers' and the stack's limits it stays under: a frame above it is not
 * one the engine wrote.
 */
export const FRAME_BYTES = 16 * 1024;

/**
 * The header of a reply frame, all numbers big-endian: a `u8` version, a `u8`
 * of flags, the `u32` id of the request answered and the `u32` place of the
 * frame in its reply, from 0. The engine's `FRAME_HEADER_BYTES`.
 */
export const FRAME_HEADER_BYTES = 10;
export const FRAME_VERSION = 1;
export const FLAG_GZIP = 1;
export const FLAG_LAST = 2;

/** How long an ask waits for its reply before it is an error the page acts on. */
export const REPLY_TIMEOUT_MS = 30_000;

/**
 * A message the page cannot read as this protocol: a reply in another format,
 * a frame of another version or a message too short to be a frame. Every ask
 * in flight fails with it, since none of them can be answered in a format the
 * page reads.
 */
export class UnreadableReply extends Error {}

type Waiting = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type Held = { next: number; gzip: boolean; chunks: Uint8Array[] };

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The asks in flight and the reply frames held for them. A frame carries the
 * id of its request, so the frames of several replies may interleave.
 */
export class Replies {
  private waiting = new Map<number, Waiting>();
  private held = new Map<number, Held>();

  has(id: number): boolean {
    return this.waiting.has(id);
  }

  /** A promise for the reply to ask `id`, rejected when none comes in time. */
  wait(id: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        this.held.delete(id);
        reject(new Error(`no reply in ${REPLY_TIMEOUT_MS / 1000} s`));
      }, REPLY_TIMEOUT_MS);
      this.waiting.set(id, { resolve, reject, timer });
    });
  }

  /** Hand a reply to the ask it answers. */
  settle(reply: Reply) {
    const waiting = this.waiting.get(reply.id);
    if (!waiting) return;
    clearTimeout(waiting.timer);
    this.waiting.delete(reply.id);
    if (reply.error !== undefined) waiting.reject(new Error(String(reply.error)));
    else waiting.resolve(reply.result);
  }

  /** Reject every ask and forget every frame held, as a connection ends. */
  rejectAll(message: string) {
    this.failAll(new Error(message));
  }

  private failAll(error: Error) {
    for (const { reject, timer } of this.waiting.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.waiting.clear();
    this.held.clear();
  }

  /** Fail every ask in flight, since the phone's replies are not in this page's format. */
  private unreadable(detail: string): undefined {
    this.failAll(new UnreadableReply(`${detail}; update Veloq on the phone`));
    return undefined;
  }

  /** Forget the frames held without touching the asks. */
  clear() {
    this.held.clear();
  }

  /**
   * Take one message off the data channel. A frame is held under its id until
   * the last arrives, and then the reply is inflated if the frames say so and
   * parsed. Nothing is returned for a frame of this version for an id nothing
   * asked, or for a frame that is not the last. A reply that cannot be read is
   * returned as an error for its id, so its ask fails rather than waits. A
   * message that is not a frame of this version fails every ask in flight with
   * `UnreadableReply`, since the phone speaks another format.
   */
  async take(message: unknown, asked: (id: number) => boolean): Promise<Reply | undefined> {
    if (!(message instanceof ArrayBuffer) && !ArrayBuffer.isView(message)) {
      if (typeof message === 'string') this.unreadable('the phone sent a text reply');
      return undefined;
    }
    const bytes =
      message instanceof ArrayBuffer
        ? new Uint8Array(message)
        : new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
    if (bytes.length < FRAME_HEADER_BYTES || bytes.length > FRAME_BYTES) {
      return this.unreadable(`the phone sent a message of ${bytes.length} bytes`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint8(0);
    const flags = view.getUint8(1);
    const id = view.getUint32(2);
    const seq = view.getUint32(6);
    if (version !== FRAME_VERSION) {
      return this.unreadable(`the phone sent a reply frame of version ${version}`);
    }
    if (!asked(id)) return undefined;
    const held = this.held.get(id) ?? { next: 0, gzip: (flags & FLAG_GZIP) !== 0, chunks: [] };
    if (seq !== held.next) {
      this.held.delete(id);
      return { id, error: 'a reply frame arrived out of order' };
    }
    held.next += 1;
    held.chunks.push(bytes.slice(FRAME_HEADER_BYTES));
    if ((flags & FLAG_LAST) === 0) {
      this.held.set(id, held);
      return undefined;
    }
    this.held.delete(id);
    const body = new Uint8Array(held.chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let at = 0;
    for (const chunk of held.chunks) {
      body.set(chunk, at);
      at += chunk.length;
    }
    try {
      const raw = held.gzip ? await inflate(body) : body;
      const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
      return { ...(parsed as object), id };
    } catch {
      return { id, error: 'a reply could not be read' };
    }
  }
}

/** Cards in one page of the feed table, the most the phone answers at once. */
export const FEED_PAGE_SIZE = 100;

/** Days of wellness the feed's sparklines reach back, as the phone's card asks. */
export const FEED_SPARKLINE_DAYS = 30;

/**
 * What narrows the feed: the sport family chips, the search text and the span
 * of start times in epoch seconds (unbounded when absent).
 */
export type FeedFilter = {
  families: SportFamily[];
  needle: string;
  oldestTs?: number | null;
  newestTs?: number | null;
};

export type SportFamily = Methods['feed.page']['params']['sportFamilies'][number];

/** The ask for the page of the feed that starts at `offset` under `filter`. */
export function feedPageAsk(filter: FeedFilter, offset: number): Methods['feed.page']['params'] {
  return {
    offset,
    limit: FEED_PAGE_SIZE,
    needle: filter.needle,
    sportFamilies: filter.families,
    oldestTs: filter.oldestTs ?? null,
    newestTs: filter.newestTs ?? null,
  };
}

/**
 * The asks that open the feed screen: the summary card, the sparklines and
 * the first page, each only if the phone listed the method.
 */
export function feedOpening(
  methods: readonly string[],
  filter: FeedFilter,
  nowWallSeconds: number
): { method: string; params: object }[] {
  const asks: { method: string; params: object }[] = [
    { method: 'feed.summary', params: { nowWallSeconds } },
    { method: 'feed.sparklines', params: { days: FEED_SPARKLINE_DAYS } },
    { method: 'feed.page', params: feedPageAsk(filter, 0) },
  ];
  return asks.filter((ask) => methods.includes(ask.method));
}

/**
 * The rows shown once a page answers: the first page replaces every row, so a
 * changed filter never leaves old rows behind, and a later page is appended
 * without repeating a row already held.
 */
export function feedRows<Row extends { id: string }>(
  held: readonly Row[],
  page: readonly Row[],
  offset: number
): Row[] {
  if (offset === 0) return [...page];
  const known = new Set(held.map((row) => row.id));
  return [...held, ...page.filter((row) => !known.has(row.id))];
}

/** What the engine answers a write made while the app is not in front. */
export const PHONE_LOCKED = 'phone locked';

/**
 * The notice to show for a write that failed, or nothing when the failure is
 * not the phone being locked. The edit was not made, so the page changes
 * nothing it holds.
 */
export function writeNotice(error: unknown): string | undefined {
  const text = error instanceof Error ? error.message : String(error);
  return text === PHONE_LOCKED ? 'Unlock your phone and open Veloq to make changes' : undefined;
}
