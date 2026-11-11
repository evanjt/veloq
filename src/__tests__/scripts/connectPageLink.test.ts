/**
 * Scenario: the connect page at docs/connect/ pairs a browser with the phone,
 * reconnects to it, and shows what the phone serves.
 *
 * Expected behaviour: the page derives the same room and proofs the engine
 * does, so the two agree byte for byte. A drop while connected forgets every
 * fetched row and goes back to waiting. A phone that answers with another
 * certificate than the one paired is refused, and the page pairs afresh.
 */

import {
  INVITATION_TTL_SECS,
  answerFingerprint,
  invitation,
  normaliseFingerprint,
  peerConfiguration,
  proof,
  retryDelay,
  roomFor,
  step,
  withoutHiddenCandidates,
  type State,
} from '../../../docs/connect/link.js';

const BROWSER = 'sha-256 AA:AA';
const PHONE = 'sha-256 BB:BB';
const SEVENS = new Uint8Array(32).fill(7);

const doing = (result: { effects: { do: string }[] }) => result.effects.map((effect) => effect.do);

function connected(): State {
  return {
    name: 'connected',
    phone: PHONE,
    attempt: 0,
    feed: [{ id: 'i1' }],
    detail: { id: 'i1' },
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
      feed: null,
      detail: null,
    });
    expect(doing(open)).toEqual(['fetchFeed']);
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
    expect(confirmed.effects).toEqual([{ do: 'remember', phone: PHONE }, { do: 'fetchFeed' }]);
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

  it('keeps only the rows of the connection that fetched them', () => {
    const shown = step(connected(), { type: 'feed', rows: [{ id: 'i2' }] });
    expect(shown.state).toMatchObject({ name: 'connected', feed: [{ id: 'i2' }] });
    const late = step({ name: 'waiting', phone: PHONE, attempt: 1 }, { type: 'feed', rows: [] });
    expect(late.state).toEqual({ name: 'waiting', phone: PHONE, attempt: 1 });
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
    expect(confirmed.effects).toEqual([{ do: 'remember', phone: PHONE }, { do: 'fetchFeed' }]);
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
