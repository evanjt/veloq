/**
 * Scenario: the connect page at web/connect/ pairs a browser with the phone,
 * reconnects to it, and shows what the phone serves.
 *
 * Expected behaviour: the page derives the same room and proofs the engine
 * does, so the two agree byte for byte. A drop while connected forgets every
 * fetched row and goes back to waiting. A phone that answers with another
 * certificate than the one paired is refused, and the page pairs afresh.
 */

import zlib from 'zlib';

import {
  INVITATION_TTL_SECS,
  PAGE_PROTOCOL,
  REPLY_TIMEOUT_MS,
  Replies,
  UnreadableReply,
  answerFingerprint,
  bytesOf,
  FEED_PAGE_SIZE,
  FEED_SPARKLINE_DAYS,
  feedOpening,
  feedPageAsk,
  feedRows,
  floatsOf,
  invitation,
  normaliseFingerprint,
  peerConfiguration,
  proof,
  retryDelay,
  roomFor,
  step,
  withoutHiddenCandidates,
  writeNotice,
  type State,
} from '../../../web/connect/link';

const BROWSER = 'sha-256 AA:AA';
const PHONE = 'sha-256 BB:BB';
const SEVENS = new Uint8Array(32).fill(7);

const doing = (result: { effects: { do: string }[] }) => result.effects.map((effect) => effect.do);

function connected(): State {
  return {
    name: 'connected',
    phone: PHONE,
    attempt: 0,
    methods: ['link.hello', 'feed.page', 'activity.summary'],
  };
}

describe('the derivations the engine repeats', () => {
  it('meets the phone in the room the engine derives for the pair', async () => {
    expect(await roomFor(BROWSER, PHONE)).toBe('lD6s7KZ5brFE6GjE1k-PwiGY80A1aFGhYeKG78_Kp9k');
  });

  it('makes the proofs the engine verifies and sends', async () => {
    expect(await proof(SEVENS, 'browser', BROWSER, PHONE)).toBe(
      '16ciA_4XJnU5nHLUTkHePDq2ZbfrfHrQgx0jCQaPd9I'
    );
    expect(await proof(SEVENS, 'phone', BROWSER, PHONE)).toBe(
      'TlDbU8Ohyd2tEY4OwpeJtKbwygW0gtVBurQ8TdghUk8'
    );
  });

  it('spells a fingerprint the way pins are kept', () => {
    expect(normaliseFingerprint('SHA-256', 'ab:cd')).toBe('sha-256 AB:CD');
    const sdp = 'v=0\r\na=fingerprint:sha-256 ab:cd:ef\r\na=setup:active\r\n';
    expect(answerFingerprint(sdp)).toBe('sha-256 AB:CD:EF');
    expect(answerFingerprint('v=0\r\n')).toBeNull();
  });

  it('writes an invitation that lasts the two minutes the engine allows', () => {
    const code = JSON.parse(
      invitation({ room: 'room-0123456789abcdefghij', secret: SEVENS, fp: BROWSER, now: 1000 })
    );
    expect(code).toEqual({
      v: 1,
      room: 'room-0123456789abcdefghij',
      secret: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
      fp: BROWSER,
      exp: 1000 + INVITATION_TTL_SECS,
    });
    expect(INVITATION_TTL_SECS).toBeLessThanOrEqual(120);
  });

  it('drops the hidden host names the phone cannot reach, and keeps every other line', () => {
    const sdp = [
      'v=0',
      'a=candidate:1 1 udp 2122260223 4f1e7a0c-1111.local 54321 typ host',
      'a=candidate:2 1 udp 2122260223 203.0.113.20 54322 typ host',
      'a=fingerprint:sha-256 AA:AA',
      '',
    ].join('\r\n');
    expect(withoutHiddenCandidates(sdp)).toBe(
      [
        'v=0',
        'a=candidate:2 1 udp 2122260223 203.0.113.20 54322 typ host',
        'a=fingerprint:sha-256 AA:AA',
        '',
      ].join('\r\n')
    );
  });
});

describe('the connect page state machine', () => {
  it('asks for a code to scan when nothing is paired, and waits in the room when one is', () => {
    expect(step({ name: 'unpaired' }, { type: 'start', phone: null }).effects).toEqual([
      { do: 'invite' },
    ]);
    const paired = step({ name: 'unpaired' }, { type: 'start', phone: PHONE });
    expect(paired.state.name).toBe('waiting');
    expect(paired.effects).toEqual([{ do: 'joinLinked', phone: PHONE }]);
  });

  it('offers as soon as the relay says the phone is in the room', () => {
    const waiting = step({ name: 'unpaired' }, { type: 'start', phone: PHONE }).state;
    const next = step(waiting, { type: 'peer' });
    expect(next.state.name).toBe('connecting');
    expect(doing(next)).toEqual(['offer']);
  });

  it('forgets every fetched row on a drop while connected and goes back to waiting', () => {
    const next = step(connected(), { type: 'drop' });
    expect(next.state).toEqual({ name: 'waiting', phone: PHONE, attempt: 1 });
    expect(JSON.stringify(next.state)).not.toContain('i1');
    expect(doing(next)).toEqual(['hangUp', 'retry']);
  });

  it('waits longer after each failed try, up to a cap', () => {
    expect(retryDelay(0)).toBeLessThan(retryDelay(1));
    expect(retryDelay(1)).toBeLessThan(retryDelay(3));
    expect(retryDelay(50)).toBe(retryDelay(51));
  });

  it('refuses a phone that answers with another certificate, and pairs afresh', () => {
    const connecting: State = { name: 'connecting', phone: PHONE, attempt: 0 };
    const next = step(connecting, { type: 'answered', fingerprint: 'sha-256 EE:EE' });
    expect(next.state).toEqual({ name: 'unpaired', notice: 'refused' });
    expect(doing(next)).toEqual(['hangUp', 'forget', 'invite']);
  });

  it('carries on with the phone it paired with', () => {
    const connecting: State = { name: 'connecting', phone: PHONE, attempt: 2 };
    const answered = step(connecting, { type: 'answered', fingerprint: PHONE });
    expect(answered.state).toEqual(connecting);
    const open = step(answered.state, { type: 'open' });
    expect(open.state).toEqual({
      name: 'connected',
      phone: PHONE,
      attempt: 0,
      methods: null,
    });
    expect(doing(open)).toEqual(['leaveRelay', 'hello']);
  });

  it('leaves the relay room once the channel is open, so a second tab can meet the phone', () => {
    const connecting: State = { name: 'connecting', phone: PHONE, attempt: 0 };
    const opened = step(connecting, { type: 'open' });
    expect(opened.state.name).toBe('connected');
    expect(doing(opened)).toContain('leaveRelay');
    expect(doing(step(opened.state, { type: 'relayClosed' }))).toEqual([]);
  });

  it('pairs only once the phone confirms, then remembers it', () => {
    const code = { room: 'room-0123456789abcdefghij', secret: SEVENS, exp: 2000 };
    let state = step({ name: 'unpaired' }, { type: 'invited', invitation: code }).state;
    expect(state.name).toBe('inviting');
    state = step(state, { type: 'peer' }).state;
    state = step(state, { type: 'answered', fingerprint: PHONE }).state;
    expect(state.name).toBe('proving');
    const open = step(state, { type: 'open' });
    expect(doing(open)).toEqual(['prove']);

    const proved = step(open.state, { type: 'proved', ok: true });
    expect(proved.state.name).toBe('confirming');
    expect(doing(proved)).toEqual(['pollStatus']);
    expect(doing(step(proved.state, { type: 'status', value: 'waiting' }))).toEqual(['pollStatus']);

    const confirmed = step(proved.state, { type: 'status', value: 'confirmed' });
    expect(confirmed.state.name).toBe('connected');
    expect(confirmed.effects).toEqual([
      { do: 'leaveRelay' },
      { do: 'remember', phone: PHONE },
      { do: 'hello' },
    ]);
  });

  it('starts over when the phone declines, or the proof fails', () => {
    const confirming: State = {
      name: 'confirming',
      invitation: { room: 'room-0123456789abcdefghij', secret: SEVENS, exp: 2000 },
      phone: PHONE,
    };
    const declined = step(confirming, { type: 'status', value: 'declined' });
    expect(declined.state).toEqual({ name: 'unpaired', notice: 'declined' });
    expect(doing(declined)).toEqual(['hangUp', 'invite']);

    const proving: State = { ...confirming, name: 'proving' };
    const failed = step(proving, { type: 'proved', ok: false });
    expect(failed.state).toEqual({ name: 'unpaired', notice: 'refused' });
    expect(doing(failed)).not.toContain('remember');
  });

  it('carries a refusal or a decline onto the new code, until the next code or a pairing replaces it', () => {
    const code = { room: 'room-0123456789abcdefghij', secret: SEVENS, exp: 2000 };
    const refused = step(
      { name: 'unpaired', notice: 'refused' },
      { type: 'invited', invitation: code }
    );
    expect(refused.state).toEqual({
      name: 'inviting',
      invitation: code,
      attempt: 0,
      notice: 'refused',
    });

    const kept = step(refused.state, { type: 'relayClosed' });
    expect(kept.state).toMatchObject({ name: 'inviting', notice: 'refused', attempt: 1 });

    const proving = step(refused.state, { type: 'answered', fingerprint: PHONE });
    expect(proving.state).toEqual({ name: 'proving', invitation: code, phone: PHONE });

    const expired = step(refused.state, { type: 'expired' });
    expect(expired.state).toEqual({ name: 'unpaired' });

    const plain = step({ name: 'unpaired' }, { type: 'invited', invitation: code });
    expect(plain.state).toEqual({ name: 'inviting', invitation: code, attempt: 0 });
  });

  it('keeps the code on screen while the relay is unreachable, and tries its room again later', () => {
    const code = { room: 'room-0123456789abcdefghij', secret: SEVENS, exp: 2000 };
    const inviting = step({ name: 'unpaired' }, { type: 'invited', invitation: code }).state;
    const first = step(inviting, { type: 'relayClosed' });
    expect(first.state).toMatchObject({ name: 'inviting', invitation: code });
    expect(first.effects).toEqual([{ do: 'rejoin', room: code.room, delay: retryDelay(0) }]);
    const second = step(first.state, { type: 'relayClosed' });
    expect(second.effects).toEqual([{ do: 'rejoin', room: code.room, delay: retryDelay(1) }]);
    expect(doing(second)).not.toContain('invite');
  });

  it('backs off from an unreachable relay while waiting for the phone', () => {
    const waiting: State = { name: 'waiting', phone: PHONE, attempt: 2 };
    const next = step(waiting, { type: 'relayClosed' });
    expect(next.state).toEqual({ name: 'waiting', phone: PHONE, attempt: 3 });
    expect(next.effects).toEqual([{ do: 'retry', delay: retryDelay(2) }]);
  });

  it('ignores the relay closing once the phone is connected directly', () => {
    expect(step(connected(), { type: 'relayClosed' })).toEqual({ state: connected(), effects: [] });
  });

  it('starts over when the phone leaves the room before the connection opens', () => {
    const inviting: State = {
      name: 'inviting',
      invitation: { room: 'room-0123456789abcdefghij', secret: SEVENS, exp: 2000 },
      attempt: 0,
    };
    const fromInviting = step(inviting, { type: 'bye' });
    expect(fromInviting.state).toEqual({ name: 'unpaired' });
    expect(doing(fromInviting)).toEqual(['hangUp', 'invite']);

    const fromWaiting = step({ name: 'waiting', phone: PHONE, attempt: 1 }, { type: 'bye' });
    expect(fromWaiting.state).toEqual({ name: 'waiting', phone: PHONE, attempt: 2 });
    expect(doing(fromWaiting)).toEqual(['hangUp', 'retry']);

    const connecting: State = { name: 'connecting', phone: PHONE, attempt: 0 };
    const fromConnecting = step(connecting, { type: 'bye' });
    expect(fromConnecting.state).toEqual({ name: 'waiting', phone: PHONE, attempt: 1 });
    expect(doing(fromConnecting)).toEqual(['hangUp', 'retry']);
  });

  it('keeps a confirmation waiting when the phone leaves the room after accepting', () => {
    const confirming: State = {
      name: 'confirming',
      invitation: { room: 'room-0123456789abcdefghij', secret: SEVENS, exp: 2000 },
      phone: PHONE,
    };
    const left = step(confirming, { type: 'bye' });
    expect(left).toEqual({ state: confirming, effects: [] });
    expect(doing(step(left.state, { type: 'status', value: 'waiting' }))).toEqual(['pollStatus']);

    const confirmed = step(left.state, { type: 'status', value: 'confirmed' });
    expect(confirmed.state.name).toBe('connected');
    expect(confirmed.effects).toEqual([
      { do: 'leaveRelay' },
      { do: 'remember', phone: PHONE },
      { do: 'hello' },
    ]);
  });

  it('keeps a proof waiting when the phone leaves the room before the proof is sent', () => {
    const proving: State = {
      name: 'proving',
      invitation: { room: 'room-0123456789abcdefghij', secret: SEVENS, exp: 2000 },
      phone: PHONE,
    };
    expect(step(proving, { type: 'bye' })).toEqual({ state: proving, effects: [] });
  });

  it('ignores the relay leaving once the phone is connected directly', () => {
    expect(step(connected(), { type: 'bye' })).toEqual({ state: connected(), effects: [] });
  });

  it('makes a new code when the open one runs out before the phone joins', () => {
    const inviting: State = {
      name: 'inviting',
      invitation: { room: 'room-0123456789abcdefghij', secret: SEVENS, exp: 2000 },
      attempt: 0,
    };
    const next = step(inviting, { type: 'expired' });
    expect(next.state).toEqual({ name: 'unpaired' });
    expect(doing(next)).toEqual(['hangUp', 'invite']);
  });
});

describe('the page asks a STUN server for its public address', () => {
  it('builds its peer connection with the pinned certificate and a STUN server', () => {
    const certificate = { expires: 1 } as unknown as RTCCertificate;
    const config = peerConfiguration(certificate);
    expect(config.certificates).toEqual([certificate]);
    expect(config.iceServers).toEqual([{ urls: 'stun:stun.cloudflare.com:3478' }]);
  });
});

describe('the page learns what the phone speaks before it asks for anything', () => {
  const listed = ['link.hello', 'feed.page', 'activity.summary'];
  const opened = (): State => ({
    name: 'connected',
    phone: PHONE,
    attempt: 0,
    methods: null,
  });

  it('keeps the method list the phone names and reads the feed from it', () => {
    const next = step(opened(), { type: 'hello', protocol: PAGE_PROTOCOL, methods: listed });
    expect(next.state).toMatchObject({ name: 'connected', methods: listed });
    expect(next.effects).toEqual([{ do: 'fetchFeed' }]);
  });

  it('asks for a method the phone listed', () => {
    const state = step(opened(), { type: 'hello', protocol: PAGE_PROTOCOL, methods: listed }).state;
    const next = step(state, { type: 'screen', method: 'activity.summary', params: { id: 'i1' } });
    expect(next.state).toBe(state);
    expect(next.effects).toEqual([{ do: 'ask', method: 'activity.summary', params: { id: 'i1' } }]);
  });

  it('shows the update state, and sends no ask, when the screen needs a method the phone did not list', () => {
    const state = step(opened(), { type: 'hello', protocol: PAGE_PROTOCOL, methods: listed }).state;
    const next = step(state, { type: 'screen', method: 'activity.streams', params: { id: 'i1' } });
    expect(next.state).toEqual({ name: 'update', phone: PHONE });
    expect(doing(next)).not.toContain('ask');
  });

  it('shows the update state at once when the phone speaks another protocol', () => {
    const next = step(opened(), {
      type: 'hello',
      protocol: PAGE_PROTOCOL + 1,
      methods: [...listed, 'activity.streams'],
    });
    expect(next.state).toEqual({ name: 'update', phone: PHONE });
    expect(doing(next)).toEqual(['hangUp']);
  });

  it('shows the update state when the phone lacks the feed the page opens with', () => {
    const next = step(opened(), {
      type: 'hello',
      protocol: PAGE_PROTOCOL,
      methods: ['link.hello'],
    });
    expect(next.state).toEqual({ name: 'update', phone: PHONE });
    expect(doing(next)).not.toContain('fetchFeed');
  });

  it('shows the update state when a reply cannot be read as this protocol, and closes the connection', () => {
    const next = step(opened(), { type: 'mismatch' });
    expect(next.state).toEqual({ name: 'update', phone: PHONE });
    expect(doing(next)).toEqual(['hangUp']);
  });

  it('shows the update state when a pairing reply cannot be read, rather than refusing the pairing', () => {
    const proving: State = {
      name: 'proving',
      invitation: { room: 'room', secret: SEVENS, exp: 0 },
      phone: PHONE,
    };
    expect(step(proving, { type: 'mismatch' }).state).toEqual({ name: 'update', phone: PHONE });
  });

  it('asks nothing of a phone whose list it has not yet read', () => {
    const next = step(opened(), { type: 'screen', method: 'feed.page' });
    expect(next.state).toEqual({ name: 'update', phone: PHONE });
    expect(doing(next)).not.toContain('ask');
  });

  it('leaves the update state only by unlinking', () => {
    const update: State = { name: 'update', phone: PHONE };
    expect(step(update, { type: 'drop' }).state).toBe(update);
    expect(step(update, { type: 'forget' }).state).toEqual({ name: 'unpaired' });
  });
});

describe('the page reads the byte fields the engine writes', () => {
  it('decodes a base64 string to its bytes, and an empty one to none', () => {
    expect([...bytesOf('AAEC+vv8/Q==')]).toEqual([0, 1, 2, 250, 251, 252, 253]);
    expect(bytesOf('')).toHaveLength(0);
  });

  it('reads a run of floats from its little-endian bytes', () => {
    const floats = new Float32Array([1.5, -0.25, 40_000]);
    const text = Buffer.from(floats.buffer).toString('base64');
    expect([...floatsOf(text)]).toEqual([1.5, -0.25, 40_000]);
  });
});

const GZIP = 1;
const LAST = 2;

/** A frame as the engine writes it: version, flags, request id, sequence, body. */
function frame(id: number, seq: number, flags: number, body: Uint8Array, version = 1) {
  const out = new Uint8Array(10 + body.length);
  const view = new DataView(out.buffer);
  view.setUint8(0, version);
  view.setUint8(1, flags);
  view.setUint32(2, id);
  view.setUint32(6, seq);
  out.set(body, 10);
  return out;
}
const text = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('the page puts framed replies back together', () => {
  const gzip = (bytes: Uint8Array) => new Uint8Array(zlib.gzipSync(bytes));

  it('joins the frames of one reply and parses it', async () => {
    const replies = new Replies();
    const whole = text({ id: 7, result: { line: 'abcdef' } });
    expect(
      await replies.take(frame(7, 0, 0, whole.slice(0, 10)), (id) => id === 7)
    ).toBeUndefined();
    expect(await replies.take(frame(7, 1, LAST, whole.slice(10)), (id) => id === 7)).toEqual({
      id: 7,
      result: { line: 'abcdef' },
    });
  });

  it('keeps the frames of two interleaved ids apart', async () => {
    const replies = new Replies();
    const asked = () => true;
    const a = text({ id: 1, result: 'first reply' });
    const b = text({ id: 2, result: 'second reply' });
    expect(await replies.take(frame(1, 0, 0, a.slice(0, 5)), asked)).toBeUndefined();
    expect(await replies.take(frame(2, 0, 0, b.slice(0, 5)), asked)).toBeUndefined();
    expect(await replies.take(frame(2, 1, LAST, b.slice(5)), asked)).toEqual({
      id: 2,
      result: 'second reply',
    });
    expect(await replies.take(frame(1, 1, LAST, a.slice(5)), asked)).toEqual({
      id: 1,
      result: 'first reply',
    });
  });

  it('inflates a gzipped body', async () => {
    const replies = new Replies();
    const packed = gzip(text({ id: 3, result: 'z'.repeat(50_000) }));
    const half = packed.length >> 1;
    expect(
      await replies.take(frame(3, 0, GZIP, packed.slice(0, half)), () => true)
    ).toBeUndefined();
    expect(await replies.take(frame(3, 1, GZIP | LAST, packed.slice(half)), () => true)).toEqual({
      id: 3,
      result: 'z'.repeat(50_000),
    });
  });

  it('fails every ask in flight when a frame has another version, since the phone speaks another format', async () => {
    const replies = new Replies();
    const waiting = replies.wait(7);
    const outcome = expect(waiting).rejects.toBeInstanceOf(UnreadableReply);
    await replies.take(frame(7, 0, LAST, text({ id: 7 }), 2), (id) => id === 7);
    await outcome;
    await expect(waiting).rejects.toThrow('version 2');
    expect(replies.has(7)).toBe(false);
  });

  it('rejects the ask whose frames arrive out of order or whose body is not gzip', async () => {
    const replies = new Replies();
    const skipped = await replies.take(frame(7, 1, LAST, text({})), (id) => id === 7);
    expect(skipped).toMatchObject({ id: 7 });
    expect(skipped).toHaveProperty('error');
    const bad = await replies.take(frame(7, 0, GZIP | LAST, text({ id: 7 })), (id) => id === 7);
    expect(bad).toHaveProperty('error');
  });

  it('ignores a frame for an id nothing asked', async () => {
    const replies = new Replies();
    expect(
      await replies.take(frame(9, 0, LAST, text({ id: 9 })), (id) => id === 7)
    ).toBeUndefined();
  });

  it('fails every ask in flight on a reply in the previous text format, rather than dropping it', async () => {
    const replies = new Replies();
    const hello = replies.wait(1);
    const outcome = expect(hello).rejects.toBeInstanceOf(UnreadableReply);
    expect(
      await replies.take('{"id":1,"result":{"protocol":2,"app":"0.4.1","methods":[]}}', () => true)
    ).toBeUndefined();
    await outcome;
    expect(replies.has(1)).toBe(false);
  });

  it('fails every ask in flight on a message too short to be a frame', async () => {
    const replies = new Replies();
    const waiting = replies.wait(3);
    const outcome = expect(waiting).rejects.toBeInstanceOf(UnreadableReply);
    expect(await replies.take(new Uint8Array(4), () => true)).toBeUndefined();
    await outcome;
  });

  it('drops the frames held for an ask that a later unreadable message fails', async () => {
    const replies = new Replies();
    const whole = text({ id: 7, result: 1 });
    const waiting = replies.wait(7);
    const outcome = expect(waiting).rejects.toBeInstanceOf(UnreadableReply);
    await replies.take(frame(7, 0, 0, whole.slice(0, 4)), () => true);
    await replies.take('{}', () => true);
    await outcome;
    expect(await replies.take(frame(7, 1, LAST, whole.slice(4)), () => true)).toHaveProperty(
      'error'
    );
  });

  it('forgets the frames held when the connection drops', async () => {
    const replies = new Replies();
    const whole = text({ id: 7, result: 1 });
    await replies.take(frame(7, 0, 0, whole.slice(0, 4)), () => true);
    replies.clear();
    const late = await replies.take(frame(7, 1, LAST, whole.slice(4)), () => true);
    expect(late).toHaveProperty('error');
  });
});

describe('an ask waits for its reply only so long', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('rejects at its timeout and clears its entry', async () => {
    const replies = new Replies();
    const waiting = replies.wait(4);
    const outcome = expect(waiting).rejects.toThrow('no reply');
    expect(replies.has(4)).toBe(true);
    jest.advanceTimersByTime(REPLY_TIMEOUT_MS);
    await outcome;
    expect(replies.has(4)).toBe(false);
  });

  it('resolves with the result and stops the clock', async () => {
    const replies = new Replies();
    const waiting = replies.wait(4);
    replies.settle({ id: 4, result: 'done' });
    await expect(waiting).resolves.toBe('done');
    expect(replies.has(4)).toBe(false);
    jest.advanceTimersByTime(REPLY_TIMEOUT_MS);
  });

  it('rejects with the error the phone gave', async () => {
    const replies = new Replies();
    const waiting = replies.wait(4);
    replies.settle({ id: 4, error: 'unknown method: x' });
    await expect(waiting).rejects.toThrow('unknown method: x');
  });

  it('rejects every ask when the connection ends', async () => {
    const replies = new Replies();
    const one = expect(replies.wait(1)).rejects.toThrow('hung up');
    const two = expect(replies.wait(2)).rejects.toThrow('hung up');
    replies.rejectAll('hung up');
    await one;
    await two;
    expect(replies.has(1)).toBe(false);
  });
});

describe('the feed screen reads the phone summary, sparklines and a filtered page', () => {
  const listed = ['link.hello', 'feed.page', 'feed.summary', 'feed.sparklines', 'feed.highlights'];
  const none = { families: [], needle: '' };

  it('fetches the summary card, the sparklines and the first page when connected', () => {
    const asks = feedOpening(listed, none, 1_737_050_000);
    expect(asks).toEqual([
      { method: 'feed.summary', params: { nowWallSeconds: 1_737_050_000 } },
      { method: 'feed.sparklines', params: { days: FEED_SPARKLINE_DAYS } },
      { method: 'feed.page', params: feedPageAsk(none, 0) },
    ]);
    expect(feedPageAsk(none, 0)).toEqual({
      offset: 0,
      limit: FEED_PAGE_SIZE,
      needle: '',
      sportFamilies: [],
      oldestTs: null,
      newestTs: null,
    });
  });

  it('skips a read the phone did not list and still opens the page', () => {
    const asks = feedOpening(['link.hello', 'feed.page'], none, 5);
    expect(asks.map((ask) => ask.method)).toEqual(['feed.page']);
  });

  it('asks the page again with the chosen family and search, from the top', () => {
    const ask = feedPageAsk({ families: ['run'], needle: 'track' }, 0);
    expect(ask).toMatchObject({ offset: 0, sportFamilies: ['run'], needle: 'track' });
  });

  it('asks the page within the chosen span of start times', () => {
    const ask = feedPageAsk({ families: [], needle: '', oldestTs: 100, newestTs: 200 }, 100);
    expect(ask).toMatchObject({ offset: 100, limit: FEED_PAGE_SIZE, oldestTs: 100, newestTs: 200 });
  });

  it('drops the old rows when the first page answers, and appends a later page', () => {
    const old = [{ id: 'a' }, { id: 'b' }];
    expect(feedRows(old, [{ id: 'c' }], 0)).toEqual([{ id: 'c' }]);
    expect(feedRows(old, [{ id: 'c' }], 2)).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(feedRows(old, [], 0)).toEqual([]);
  });

  it('does not repeat a row a later page returns again', () => {
    expect(feedRows([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }], 1)).toEqual([
      { id: 'a' },
      { id: 'b' },
    ]);
  });
});

describe('the page explains a write the locked phone refused', () => {
  it('shows the unlock notice for the reply a locked phone gives a write', async () => {
    const replies = new Replies();
    const write = replies.wait(4);
    const reply = await replies.take(
      frame(4, 0, LAST, text({ id: 4, error: 'phone locked' })),
      (id) => replies.has(id)
    );
    expect(reply).toEqual({ id: 4, error: 'phone locked' });
    replies.settle(reply!);
    const error = await write.catch((e: unknown) => e);
    expect(writeNotice(error)).toBe('Unlock your phone and open Veloq to make changes');
  });

  it('shows nothing for any other failure', () => {
    expect(writeNotice(new Error('unknown method: section.rename'))).toBeUndefined();
    expect(writeNotice(new Error('not connected'))).toBeUndefined();
    expect(writeNotice('phone locked, again')).toBeUndefined();
  });
});
