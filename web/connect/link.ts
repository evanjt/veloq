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

/** Why the phone said it was leaving, as the engine spells it. */
export type Farewell = 'background' | 'switchedOff' | 'removed' | 'disconnected' | 'declined';

const FAREWELLS = new Set<string>([
  'background',
  'switchedOff',
  'removed',
  'disconnected',
  'declined',
]);

/** Why the page is pairing afresh, shown beside the new code. */
export type Notice = 'refused' | 'declined' | 'removed' | 'unreachable';

export type State =
  | { name: 'unpaired'; notice?: Notice }
  | { name: 'inviting'; invitation: Invitation; attempt: number; notice?: Notice }
  | { name: 'proving'; invitation: Invitation; phone: string }
  | { name: 'confirming'; invitation: Invitation; phone: string }
  | {
      name: 'waiting';
      phone: string;
      attempt: number;
      reason?: Farewell;
      /** The phone answered an offer and no path formed; kept until a channel opens. */
      unreachable?: true;
    }
  | { name: 'connecting'; phone: string; attempt: number; unreachable?: true }
  | {
      name: 'connected';
      phone: string;
      attempt: number;
      methods: string[] | null;
      /** The name the phone gave itself in its hello; absent when it gave none. */
      device?: string;
    }
  | { name: 'update'; phone: string };

export type Event =
  | { type: 'start'; phone: string | null }
  | { type: 'invited'; invitation: Invitation }
  | { type: 'peer' }
  | { type: 'answered'; fingerprint: string | null }
  | { type: 'open' }
  | { type: 'proved'; ok: boolean }
  | { type: 'status'; value: string }
  | { type: 'hello'; protocol: number; methods: string[]; device?: string | null | undefined }
  | { type: 'mismatch' }
  | { type: 'screen'; method: string; params?: object }
  | { type: 'drop'; cause?: 'unreachable' }
  | { type: 'farewell'; reason: Farewell }
  | { type: 'bye' }
  | { type: 'relayOpened' }
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

/** A waiting state keeps the unreachable word through a drop, and gains it from one that carries it. */
const flag = (event: { cause?: 'unreachable' }, state: { unreachable?: true }) =>
  event.cause === 'unreachable' || state.unreachable ? { unreachable: true as const } : {};

/** Start pairing again, after a refusal or with nothing paired. */
const afresh = (notice?: Notice): Step =>
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
      if (event.type === 'relayOpened') return to({ ...state, attempt: 0 });
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
      if (event.type === 'drop')
        return afresh(event.cause === 'unreachable' ? 'unreachable' : undefined);
      if (event.type === 'expired') return afresh();
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
      if (event.type === 'farewell' && event.reason === 'declined') return afresh('declined');
      return to(state);

    case 'waiting':
      if (event.type === 'peer') {
        return to(
          {
            name: 'connecting',
            phone: state.phone,
            attempt: state.attempt,
            ...(state.unreachable ? { unreachable: true } : {}),
          },
          [{ do: 'offer' }]
        );
      }
      if (event.type === 'relayOpened') return to({ ...state, attempt: 0 });
      if (event.type === 'relayClosed') {
        return to({ ...state, attempt: state.attempt + 1 }, [
          { do: 'retry', delay: retryDelay(state.attempt) },
        ]);
      }
      if (event.type === 'drop') {
        return to({ ...state, attempt: state.attempt + 1, ...flag(event, state) }, [
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
      if (event.type === 'drop') {
        return dropped(
          state.phone,
          state.attempt,
          event.cause === 'unreachable' || !!state.unreachable
        );
      }
      return to(state);

    case 'connected':
      if (event.type === 'hello') {
        // Methods are additive within a protocol version, so a phone on the
        // same version that lacks one is older than this page, not different.
        if (event.protocol !== PAGE_PROTOCOL) return update(state.phone);
        const device = event.device?.trim();
        return step(
          { ...state, methods: event.methods, ...(device ? { device } : {}) },
          { type: 'screen', method: 'feed.page' }
        );
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
      if (event.type === 'drop') return dropped(state.phone, state.attempt, false);
      if (event.type === 'farewell') return left(state.phone, state.attempt, event.reason);
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

/**
 * The phone said why it is leaving before it hung up, so the page acts at
 * once rather than when the connection times out. A removal is final: the
 * phone no longer holds this browser, so it is forgotten and pairs afresh.
 */
function left(phone: string, attempt: number, reason: Farewell): Step {
  if (reason === 'removed') {
    return to({ name: 'unpaired', notice: 'removed' }, [
      { do: 'hangUp' },
      { do: 'forget' },
      { do: 'invite' },
    ]);
  }
  return to({ name: 'waiting', phone, attempt: attempt + 1, reason }, [
    { do: 'hangUp' },
    { do: 'retry', delay: retryDelay(attempt) },
  ]);
}

function dropped(phone: string, attempt: number, unreachable: boolean): Step {
  return to(
    { name: 'waiting', phone, attempt: attempt + 1, ...(unreachable ? { unreachable: true } : {}) },
    [{ do: 'hangUp' }, { do: 'retry', delay: retryDelay(attempt) }]
  );
}

/** A reply from the phone: its id and either a result or an error. */
export interface Reply {
  id: number;
  result?: unknown;
  error?: unknown;
  event?: unknown;
  generation?: unknown;
  reason?: unknown;
}

/**
 * The reason the phone gives for leaving, or nothing when the message is
 * anything else. It is an event under request id 0, `{"event":"farewell",
 * "reason":…}`, which no ask is waiting on.
 */
export function farewellOf(reply: Reply): Farewell | undefined {
  if (reply.id !== 0 || reply.event !== 'farewell') return undefined;
  return typeof reply.reason === 'string' && FAREWELLS.has(reply.reason)
    ? (reply.reason as Farewell)
    : undefined;
}

/**
 * Whether a message is the phone's word that its library changed: an event
 * under request id 0, which no ask of the page uses.
 */
export function isChanged(reply: Reply): boolean {
  return reply.id === 0 && reply.event === 'changed';
}

/** Methods whose answer for an id never changes once stored. */
const STABLE_METHODS = new Set(['activity.streams', 'activity.track']);

/** The key an ask is held under: the method and its params with keys sorted. */
function askKey(method: string, params: object): string {
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, inner]) => [key, sorted(inner)])
          )
        : value;
  return `${method} ${JSON.stringify(sorted(params))}`;
}

/**
 * What the phone answered on this connection, in memory only. An ask already
 * answered is not sent again. A word that the library changed drops every
 * entry but an activity's streams and track, which stay until no list carries
 * the activity. Nothing is written to storage.
 */
export class AskCache {
  private held = new Map<string, { stableId: string | null; answer: Promise<unknown> }>();

  constructor(
    private readonly send: (method: string, params: object, slot?: string) => Promise<unknown>
  ) {}

  /** The held answer for this ask, or a new ask sent in `slot`. */
  ask(method: string, params: object, slot?: string): Promise<unknown> {
    const key = askKey(method, params);
    const kept = this.held.get(key);
    if (kept) return kept.answer;
    const id = (params as { id?: unknown }).id;
    const stableId = STABLE_METHODS.has(method) && typeof id === 'string' ? id : null;
    const answer = this.send(method, params, slot);
    const entry = { stableId, answer };
    this.held.set(key, entry);
    answer.catch(() => {
      if (this.held.get(key) === entry) this.held.delete(key);
    });
    return answer;
  }

  /** The library changed: forget every list and detail. */
  changed() {
    for (const [key, entry] of this.held) if (entry.stableId === null) this.held.delete(key);
  }

  /** Forget the streams and track of every activity not in `ids`. */
  keepOnly(ids: Iterable<string>) {
    const listed = new Set(ids);
    for (const [key, entry] of this.held) {
      if (entry.stableId !== null && !listed.has(entry.stableId)) this.held.delete(key);
    }
  }

  clear() {
    this.held.clear();
  }
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

/** Why an ask was rejected: a newer ask in its slot replaced it. Callers ignore it. */
export class SupersededError extends Error {
  constructor() {
    super('superseded');
    this.name = 'SupersededError';
  }
}

export function isSuperseded(error: unknown): boolean {
  return error instanceof Error && error.name === 'SupersededError';
}

/**
 * The message that withdraws ask `id`. The engine removes it if it is still
 * queued, and drops its reply if it is running. A cancel has no reply.
 */
export function cancelMessage(id: number): string {
  return JSON.stringify({ method: 'cancel', params: { id } });
}

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
  slot?: string;
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
  /** The ask outstanding in each slot. */
  private slots = new Map<string, number>();

  has(id: number): boolean {
    return this.waiting.has(id);
  }

  /** A promise for the reply to ask `id`, rejected when none comes in time. */
  wait(id: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.forget(id);
        reject(new Error(`no reply in ${REPLY_TIMEOUT_MS / 1000} s`));
      }, REPLY_TIMEOUT_MS);
      this.waiting.set(id, { resolve, reject, timer });
    });
  }

  /** Drop what is held for ask `id`, and its place in its slot. */
  private forget(id: number) {
    const slot = this.waiting.get(id)?.slot;
    if (slot !== undefined && this.slots.get(slot) === id) this.slots.delete(slot);
    this.waiting.delete(id);
    this.held.delete(id);
  }

  /**
   * Put ask `id` in `slot`. The ask the slot held before, if it is still
   * outstanding, is rejected as superseded and its id returned for a cancel.
   */
  supersede(slot: string, id: number): number | undefined {
    const earlier = this.slots.get(slot);
    this.slots.set(slot, id);
    const current = this.waiting.get(id);
    if (current) current.slot = slot;
    const old = earlier === undefined ? undefined : this.waiting.get(earlier);
    if (earlier === undefined || earlier === id || !old) return undefined;
    clearTimeout(old.timer);
    this.waiting.delete(earlier);
    this.held.delete(earlier);
    old.reject(new SupersededError());
    return earlier;
  }

  /** Hand a reply to the ask it answers. */
  settle(reply: Reply) {
    const waiting = this.waiting.get(reply.id);
    if (!waiting) return;
    clearTimeout(waiting.timer);
    this.forget(reply.id);
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
    this.slots.clear();
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

/**
 * The span of days each strength period reads, keyed by the period the
 * strength tab's `period` query names.
 */
export const STRENGTH_PERIOD_DAYS: Readonly<Record<string, number>> = {
  '7d': 7,
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
};

/** The period a strength tab opens on when the address names none, or an unknown one. */
export const STRENGTH_PERIOD_DEFAULT = '7d';

/** The days a strength period reads: the named period's span, else the default's. */
export function strengthPeriodDays(period: string | null): number {
  return STRENGTH_PERIOD_DAYS[period ?? ''] ?? STRENGTH_PERIOD_DAYS[STRENGTH_PERIOD_DEFAULT] ?? 7;
}

/**
 * The phone's wall clock in seconds, from the browser's own: the instant in
 * epoch seconds shifted by the zone's offset, so it reads the local date and
 * time the way an activity's date is stamped.
 */
export function wallSeconds(nowMs: number, zoneOffsetMinutes: number): number {
  return nowMs / 1000 - zoneOffsetMinutes * 60;
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

/** The settings the page shows, in the order the phone's settings list has them. */
export const SETTING_LABELS: readonly (readonly [key: string, label: string])[] = [
  ['veloq-theme-preference', 'Theme'],
  ['veloq-language-preference', 'Language'],
  ['veloq-unit-preference', 'Units'],
  ['veloq-primary-sport', 'Primary sport'],
  ['veloq-wellness-smoothing', 'Wellness smoothing'],
  ['veloq-map-preferences', 'Map'],
  ['veloq-route-settings', 'Routes'],
  ['veloq-notification-preferences', 'Notifications'],
  ['veloq-recording-preferences', 'Recording'],
  ['veloq-experimental', 'Experimental features'],
  ['dashboard_summary_card', 'Summary card'],
];

/** One line of the settings view. No row can be changed from the page yet. */
export type SettingRow = { key: string; label: string; value: string; editable: false };

const SETTING_VALUE_CHARS = 120;

/** The words a stored value is shown as; a value not set on the phone says so. */
function settingText(value: string | null | undefined): string {
  if (value == null) return 'Not set';
  return value.length > SETTING_VALUE_CHARS ? `${value.slice(0, SETTING_VALUE_CHARS)}…` : value;
}

/**
 * The rows of the settings view from the phone's answer: one per setting the
 * page knows, each with the value the phone holds, and none editable.
 */
export function settingRows(answer: Methods['settings.get']['result'] | undefined): SettingRow[] {
  const held = new Map((answer?.values ?? []).map((entry) => [entry.key, entry.value]));
  return SETTING_LABELS.filter(([key]) => held.has(key)).map(([key, label]) => ({
    key,
    label,
    value: settingText(held.get(key)),
    editable: false,
  }));
}

/**
 * The asks that open the settings screen: the settings, the profile and each
 * status, only those the phone listed.
 */
export function settingsOpening(methods: readonly string[]): { method: string; params: object }[] {
  const asks: { method: string; params: object }[] = [
    { method: 'settings.get', params: { keys: SETTING_LABELS.map(([key]) => key) } },
    { method: 'settings.profile', params: {} },
    { method: 'status.backgroundJobs', params: {} },
    { method: 'status.cache', params: {} },
    { method: 'status.backup', params: {} },
    { method: 'status.linkedDevices', params: {} },
    { method: 'status.coverage', params: {} },
    { method: 'status.sync', params: {} },
  ];
  return asks.filter((ask) => methods.includes(ask.method));
}

/** The linked devices as lines, the browser that is reading marked. */
export function deviceLines(answer: Methods['status.linkedDevices']['result']): string[] {
  return answer.devices.map(
    (device) => `${device.name}${device.id === answer.thisBrowser ? ' (this browser)' : ''}`
  );
}
