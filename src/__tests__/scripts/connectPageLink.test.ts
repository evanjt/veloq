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
  AskCache,
  INVITATION_TTL_SECS,
  PAGE_MIN_PROTOCOL,
  PAGE_PROTOCOL,
  REPLY_TIMEOUT_MS,
  Replies,
  UnreadableReply,
  answerFingerprint,
  bytesOf,
  farewellOf,
  cancelMessage,
  isSuperseded,
  FEED_PAGE_SIZE,
  FEED_SPARKLINE_DAYS,
  SETTING_LABELS,
  deviceLines,
  settingRows,
  settingsOpening,
  feedOpening,
  feedPageAsk,
  feedRows,
  floatsOf,
  invitation,
  negotiate,
  isChanged,
  normaliseFingerprint,
  olderPage,
  peerConfiguration,
  proof,
  retryDelay,
  roomFor,
  step,
  strengthPeriodDays,
  wallSeconds,
  withoutHiddenCandidates,
  writeNotice,
  type State,
} from '../../../web/connect/link';
import { bestEffortsAsk, createSlots, rangeAsks, screenAsk } from '../../../web/connect/fitness';

const BROWSER = 'sha-256 AA:AA';
const PHONE = 'sha-256 BB:BB';
const SEVENS = new Uint8Array(32).fill(7);

const doing = (result: { effects: { do: string }[] }) => result.effects.map((effect) => effect.do);

function connected(): State {
  return {
    name: 'connected',
    phone: PHONE,
    attempt: 0,
    version: PAGE_PROTOCOL,
    methods: ['link.hello', 'feed.page', 'activity.summary'],
  };
}

describe('the derivations the engine repeats', () => {
  vaultIt('meets the phone in the room the engine derives for the pair', async () => {
    expect(await roomFor(BROWSER, PHONE)).toBe('lD6s7KZ5brFE6GjE1k-PwiGY80A1aFGhYeKG78_Kp9k');
  });

  vaultIt('makes the proofs the engine verifies and sends', async () => {
    expect(await proof(SEVENS, 'browser', BROWSER, PHONE)).toBe(
      '16ciA_4XJnU5nHLUTkHePDq2ZbfrfHrQgx0jCQaPd9I'
    );
    expect(await proof(SEVENS, 'phone', BROWSER, PHONE)).toBe(
      'TlDbU8Ohyd2tEY4OwpeJtKbwygW0gtVBurQ8TdghUk8'
    );
  });

  vaultIt('spells a fingerprint the way pins are kept', () => {
    expect(normaliseFingerprint('SHA-256', 'ab:cd')).toBe('sha-256 AB:CD');
    const sdp = 'v=0\r\na=fingerprint:sha-256 ab:cd:ef\r\na=setup:active\r\n';
    expect(answerFingerprint(sdp)).toBe('sha-256 AB:CD:EF');
    expect(answerFingerprint('v=0\r\n')).toBeNull();
  });

  vaultIt('writes an invitation that lasts the two minutes the engine allows', () => {
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

  vaultIt('drops the hidden host names the phone cannot reach, and keeps every other line', () => {
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
  vaultIt(
    'asks for a code to scan when nothing is paired, and waits in the room when one is',
    () => {
      expect(step({ name: 'unpaired' }, { type: 'start', phone: null }).effects).toEqual([
        { do: 'invite' },
      ]);
      const paired = step({ name: 'unpaired' }, { type: 'start', phone: PHONE });
      expect(paired.state.name).toBe('waiting');
      expect(paired.effects).toEqual([{ do: 'joinLinked', phone: PHONE }]);
    }
  );

  vaultIt('offers as soon as the relay says the phone is in the room', () => {
    const waiting = step({ name: 'unpaired' }, { type: 'start', phone: PHONE }).state;
    const next = step(waiting, { type: 'peer' });
    expect(next.state.name).toBe('connecting');
    expect(doing(next)).toEqual(['offer']);
  });

  vaultIt('forgets every fetched row on a drop while connected and goes back to waiting', () => {
    const next = step(connected(), { type: 'drop' });
    expect(next.state).toEqual({ name: 'waiting', phone: PHONE, attempt: 1 });
    expect(JSON.stringify(next.state)).not.toContain('i1');
    expect(doing(next)).toEqual(['hangUp', 'retry']);
  });

  vaultIt(
    'tells an unreachable phone from a plain drop, and keeps the word until a channel opens',
    () => {
      const connecting: State = { name: 'connecting', phone: PHONE, attempt: 0 };
      const unreachable = step(connecting, { type: 'drop', cause: 'unreachable' });
      expect(unreachable.state).toEqual({
        name: 'waiting',
        phone: PHONE,
        attempt: 1,
        unreachable: true,
      });
      expect(doing(unreachable)).toEqual(['hangUp', 'retry']);

      const plain = step(connecting, { type: 'drop' });
      expect(plain.state).toEqual({ name: 'waiting', phone: PHONE, attempt: 1 });

      const closed = step(unreachable.state, { type: 'relayClosed' });
      expect(closed.state).toMatchObject({ name: 'waiting', unreachable: true, attempt: 2 });
      const again = step(closed.state, { type: 'drop' });
      expect(again.state).toMatchObject({ name: 'waiting', unreachable: true, attempt: 3 });
      const offered = step(again.state, { type: 'peer' });
      expect(offered.state).toMatchObject({ name: 'connecting', unreachable: true });
      const second = step(offered.state, { type: 'drop' });
      expect(second.state).toMatchObject({ name: 'waiting', unreachable: true });

      const open = step(offered.state, { type: 'open' });
      expect(open.state.name).toBe('connected');
      expect(open.state).not.toHaveProperty('unreachable');
      expect(step(open.state, { type: 'drop' }).state).toEqual({
        name: 'waiting',
        phone: PHONE,
        attempt: 1,
      });
    }
  );

  vaultIt('pairs afresh with a notice when the phone answered the offer but no path formed', () => {
    const code = { room: 'room-0123456789abcdefghij', secret: SEVENS, exp: 2000 };
    const proving: State = { name: 'proving', invitation: code, phone: PHONE };
    const next = step(proving, { type: 'drop', cause: 'unreachable' });
    expect(next.state).toEqual({ name: 'unpaired', notice: 'unreachable' });
    expect(doing(next)).toEqual(['hangUp', 'invite']);
    expect(step(proving, { type: 'drop' }).state).toEqual({ name: 'unpaired' });
  });

  vaultIt('waits longer after each failed try, up to a cap', () => {
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
      version: null,
    });
    expect(doing(open)).toEqual(['leaveRelay', 'hello']);
  });

  vaultIt(
    'leaves the relay room once the channel is open, so a second tab can meet the phone',
    () => {
      const connecting: State = { name: 'connecting', phone: PHONE, attempt: 0 };
      const opened = step(connecting, { type: 'open' });
      expect(opened.state.name).toBe('connected');
      expect(doing(opened)).toContain('leaveRelay');
      expect(doing(step(opened.state, { type: 'relayClosed' }))).toEqual([]);
    }
  );

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

  vaultIt(
    'carries a refusal or a decline onto the new code, until the next code or a pairing replaces it',
    () => {
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
    }
  );

  vaultIt(
    'keeps the code on screen while the relay is unreachable, and tries its room again later',
    () => {
      const code = { room: 'room-0123456789abcdefghij', secret: SEVENS, exp: 2000 };
      const inviting = step({ name: 'unpaired' }, { type: 'invited', invitation: code }).state;
      const first = step(inviting, { type: 'relayClosed' });
      expect(first.state).toMatchObject({ name: 'inviting', invitation: code });
      expect(first.effects).toEqual([{ do: 'rejoin', room: code.room, delay: retryDelay(0) }]);
      const second = step(first.state, { type: 'relayClosed' });
      expect(second.effects).toEqual([{ do: 'rejoin', room: code.room, delay: retryDelay(1) }]);
      expect(doing(second)).not.toContain('invite');
    }
  );

  vaultIt('backs off from an unreachable relay while waiting for the phone', () => {
    const waiting: State = { name: 'waiting', phone: PHONE, attempt: 2 };
    const next = step(waiting, { type: 'relayClosed' });
    expect(next.state).toEqual({ name: 'waiting', phone: PHONE, attempt: 3 });
    expect(next.effects).toEqual([{ do: 'retry', delay: retryDelay(2) }]);
  });

  vaultIt('retries a waiting page at the first delay each time its relay room had opened', () => {
    let state: State = { name: 'waiting', phone: PHONE, attempt: 0 };
    for (let cycle = 0; cycle < 3; cycle += 1) {
      state = step(state, { type: 'relayOpened' }).state;
      const closed = step(state, { type: 'relayClosed' });
      expect(closed.effects).toEqual([{ do: 'retry', delay: retryDelay(0) }]);
      state = closed.state;
    }
    expect(state).toEqual({ name: 'waiting', phone: PHONE, attempt: 1 });
  });

  vaultIt(
    'rejoins the code on screen at the first delay each time its relay room had opened',
    () => {
      const code = { room: 'room-0123456789abcdefghij', secret: SEVENS, exp: 2000 };
      let state = step({ name: 'unpaired' }, { type: 'invited', invitation: code }).state;
      for (let cycle = 0; cycle < 3; cycle += 1) {
        state = step(state, { type: 'relayOpened' }).state;
        const closed = step(state, { type: 'relayClosed' });
        expect(closed.effects).toEqual([{ do: 'rejoin', room: code.room, delay: retryDelay(0) }]);
        expect(closed.state).toMatchObject({ name: 'inviting', invitation: code, attempt: 1 });
        state = closed.state;
      }
    }
  );

  vaultIt('ignores the relay closing once the phone is connected directly', () => {
    expect(step(connected(), { type: 'relayClosed' })).toEqual({ state: connected(), effects: [] });
  });

  vaultIt('starts over when the phone leaves the room before the connection opens', () => {
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

  vaultIt('keeps a confirmation waiting when the phone leaves the room after accepting', () => {
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

  vaultIt('keeps a proof waiting when the phone leaves the room before the proof is sent', () => {
    const proving: State = {
      name: 'proving',
      invitation: { room: 'room-0123456789abcdefghij', secret: SEVENS, exp: 2000 },
      phone: PHONE,
    };
    expect(step(proving, { type: 'bye' })).toEqual({ state: proving, effects: [] });
  });

  vaultIt('ignores the relay leaving once the phone is connected directly', () => {
    expect(step(connected(), { type: 'bye' })).toEqual({ state: connected(), effects: [] });
  });

  vaultIt('makes a new code when the open one runs out before the phone joins', () => {
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
  vaultIt('builds its peer connection with the pinned certificate and a STUN server', () => {
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
    version: null,
  });

  vaultIt('keeps the method list the phone names and reads the feed from it', () => {
    const next = step(opened(), { type: 'hello', protocol: PAGE_PROTOCOL, methods: listed });
    expect(next.state).toMatchObject({ name: 'connected', methods: listed });
    expect(next.effects).toEqual([{ do: 'speak', version: PAGE_PROTOCOL }, { do: 'fetchFeed' }]);
  });

  vaultIt('keeps the name the phone gives itself, and none when it gives a blank one', () => {
    const named = step(opened(), {
      type: 'hello',
      protocol: PAGE_PROTOCOL,
      methods: listed,
      device: 'Pixel 8',
    });
    expect(named.state).toMatchObject({ name: 'connected', device: 'Pixel 8' });
    for (const device of [undefined, '', '  ']) {
      const unnamed = step(opened(), {
        type: 'hello',
        protocol: PAGE_PROTOCOL,
        methods: listed,
        device,
      });
      expect(unnamed.state).toMatchObject({ name: 'connected', methods: listed });
      expect((unnamed.state as { device?: string }).device).toBeUndefined();
    }
  });

  vaultIt('asks for a method the phone listed', () => {
    const state = step(opened(), { type: 'hello', protocol: PAGE_PROTOCOL, methods: listed }).state;
    const next = step(state, { type: 'screen', method: 'activity.summary', params: { id: 'i1' } });
    expect(next.state).toBe(state);
    expect(next.effects).toEqual([{ do: 'ask', method: 'activity.summary', params: { id: 'i1' } }]);
  });

  vaultIt(
    'shows the update state, and sends no ask, when the screen needs a method the phone did not list',
    () => {
      const state = step(opened(), {
        type: 'hello',
        protocol: PAGE_PROTOCOL,
        methods: listed,
      }).state;
      const next = step(state, {
        type: 'screen',
        method: 'activity.streams',
        params: { id: 'i1' },
      });
      expect(next.state).toEqual({ name: 'update', phone: PHONE });
      expect(doing(next)).not.toContain('ask');
    }
  );

  vaultIt('shows the update state at once when the phone speaks another protocol', () => {
    const next = step(opened(), {
      type: 'hello',
      protocol: PAGE_PROTOCOL + 1,
      methods: [...listed, 'activity.streams'],
    });
    expect(next.state).toEqual({ name: 'update', phone: PHONE });
    expect(doing(next)).toEqual(['hangUp']);
  });

  vaultIt('speaks the previous version to a phone that names only the previous version', () => {
    const next = step(opened(), { type: 'hello', protocol: PAGE_MIN_PROTOCOL, methods: listed });
    expect(next.state).toMatchObject({ name: 'connected', version: PAGE_MIN_PROTOCOL });
    expect(next.effects).toEqual([
      { do: 'speak', version: PAGE_MIN_PROTOCOL },
      { do: 'fetchFeed' },
    ]);
  });

  it('speaks the highest version both hold when the phone names a range', () => {
    const next = step(opened(), {
      type: 'hello',
      protocol: PAGE_PROTOCOL,
      minProtocol: PAGE_MIN_PROTOCOL,
      maxProtocol: PAGE_PROTOCOL + 1,
      methods: listed,
    });
    expect(next.state).toMatchObject({ name: 'connected', version: PAGE_PROTOCOL });
  });

  vaultIt(
    'asks the page for an older build, and shows the update state meanwhile, for a phone below the range',
    () => {
      const next = step(opened(), {
        type: 'hello',
        protocol: PAGE_MIN_PROTOCOL - 1,
        methods: listed,
      });
      expect(next.state).toEqual({ name: 'update', phone: PHONE });
      expect(next.effects).toEqual([
        { do: 'hangUp' },
        { do: 'redirect', protocol: PAGE_MIN_PROTOCOL - 1 },
      ]);
    }
  );

  vaultIt('does not look for an older build for a phone newer than the page', () => {
    const next = step(opened(), {
      type: 'hello',
      protocol: PAGE_PROTOCOL + 1,
      minProtocol: PAGE_PROTOCOL + 1,
      methods: listed,
    });
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

  vaultIt(
    'shows the update state when a reply cannot be read as this protocol, and closes the connection',
    () => {
      const next = step(opened(), { type: 'mismatch' });
      expect(next.state).toEqual({ name: 'update', phone: PHONE });
      expect(doing(next)).toEqual(['hangUp']);
    }
  );

  vaultIt(
    'shows the update state when a pairing reply cannot be read, rather than refusing the pairing',
    () => {
      const proving: State = {
        name: 'proving',
        invitation: { room: 'room', secret: SEVENS, exp: 0 },
        phone: PHONE,
      };
      expect(step(proving, { type: 'mismatch' }).state).toEqual({ name: 'update', phone: PHONE });
    }
  );

  vaultIt('asks nothing of a phone whose list it has not yet read', () => {
    const next = step(opened(), { type: 'screen', method: 'feed.page' });
    expect(next.state).toEqual({ name: 'update', phone: PHONE });
    expect(doing(next)).not.toContain('ask');
  });

  vaultIt('leaves the update state only by unlinking', () => {
    const update: State = { name: 'update', phone: PHONE };
    expect(step(update, { type: 'drop' }).state).toBe(update);
    expect(step(update, { type: 'forget' }).state).toEqual({ name: 'unpaired' });
  });
});

describe('the page and the phone agree on the highest version both speak', () => {
  it('chooses from the two ranges, and a phone that names one version speaks that alone', () => {
    expect(negotiate({ protocol: 3, minProtocol: 2, maxProtocol: 3 })).toBe(3);
    expect(negotiate({ protocol: 2 })).toBe(2);
    expect(negotiate({ protocol: 3 })).toBe(3);
    expect(negotiate({ protocol: 9, minProtocol: 3, maxProtocol: 9 })).toBe(PAGE_PROTOCOL);
  });

  it('chooses none when the ranges do not meet', () => {
    expect(negotiate({ protocol: PAGE_PROTOCOL + 1 })).toBeNull();
    expect(negotiate({ protocol: PAGE_MIN_PROTOCOL - 1 })).toBeNull();
    expect(negotiate({ protocol: 5, minProtocol: 4, maxProtocol: 5 })).toBeNull();
  });
});

describe('the page sends a phone below its range to the build that speaks its version', () => {
  const builds = [
    { path: 'v4/', min: 3, max: 4 },
    { path: 'v3/', min: 2, max: 3 },
    { path: 'v2/', min: 1, max: 2 },
  ];

  it('picks the newest kept build whose range holds the phone version', () => {
    expect(olderPage(builds, 2, 4)).toBe('v3/');
    expect(olderPage(builds, 1, 4)).toBe('v2/');
  });

  vaultIt(
    'picks nothing for a version no kept build speaks, or the build the page already is',
    () => {
      expect(olderPage(builds, 0, 4)).toBeNull();
      expect(olderPage(builds, 4, 4)).toBeNull();
      expect(olderPage([], 1, 4)).toBeNull();
    }
  );
});

describe('the page reads the byte fields the engine writes', () => {
  vaultIt('decodes a base64 string to its bytes, and an empty one to none', () => {
    expect([...bytesOf('AAEC+vv8/Q==')]).toEqual([0, 1, 2, 250, 251, 252, 253]);
    expect(bytesOf('')).toHaveLength(0);
  });

  vaultIt('reads a run of floats from its little-endian bytes', () => {
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

  vaultIt('joins the frames of one reply and parses it', async () => {
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

  vaultIt('keeps the frames of two interleaved ids apart', async () => {
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

  vaultIt('inflates a gzipped body', async () => {
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

  vaultIt(
    'rejects the ask whose frames arrive out of order or whose body is not gzip',
    async () => {
      const replies = new Replies();
      const skipped = await replies.take(frame(7, 1, LAST, text({})), (id) => id === 7);
      expect(skipped).toMatchObject({ id: 7 });
      expect(skipped).toHaveProperty('error');
      const bad = await replies.take(frame(7, 0, GZIP | LAST, text({ id: 7 })), (id) => id === 7);
      expect(bad).toHaveProperty('error');
    }
  );

  vaultIt('ignores a frame for an id nothing asked', async () => {
    const replies = new Replies();
    expect(
      await replies.take(frame(9, 0, LAST, text({ id: 9 })), (id) => id === 7)
    ).toBeUndefined();
  });

  vaultIt(
    'fails every ask in flight on a text reply once the page speaks the framed version',
    async () => {
      const replies = new Replies();
      replies.speak(3);
      const hello = replies.wait(1);
      const outcome = expect(hello).rejects.toBeInstanceOf(UnreadableReply);
      expect(
        await replies.take(
          '{"id":1,"result":{"protocol":2,"app":"0.4.1","methods":[]}}',
          () => true
        )
      ).toBeUndefined();
      await outcome;
      expect(replies.has(1)).toBe(false);
    }
  );

  vaultIt(
    'fails every ask in flight on binary frames once the page speaks the text version',
    async () => {
      const replies = new Replies();
      replies.speak(2);
      const waiting = replies.wait(1);
      const outcome = expect(waiting).rejects.toBeInstanceOf(UnreadableReply);
      expect(
        await replies.take(frame(1, 0, LAST, text({ id: 1, result: 1 })), () => true)
      ).toBeUndefined();
      await outcome;
    }
  );

  vaultIt('fails every ask in flight on a message too short to be a frame', async () => {
    const replies = new Replies();
    const waiting = replies.wait(3);
    const outcome = expect(waiting).rejects.toBeInstanceOf(UnreadableReply);
    expect(await replies.take(new Uint8Array(4), () => true)).toBeUndefined();
    await outcome;
  });

  vaultIt('drops the frames held for an ask that a later unreadable message fails', async () => {
    const replies = new Replies();
    const whole = text({ id: 7, result: 1 });
    const waiting = replies.wait(7);
    const outcome = expect(waiting).rejects.toBeInstanceOf(UnreadableReply);
    await replies.take(frame(7, 0, 0, whole.slice(0, 4)), () => true);
    await replies.take(new Uint8Array(4), () => true);
    await outcome;
    expect(await replies.take(frame(7, 1, LAST, whole.slice(4)), () => true)).toHaveProperty(
      'error'
    );
  });

  vaultIt('forgets the frames held when the connection drops', async () => {
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

  vaultIt('rejects at its timeout and clears its entry', async () => {
    const replies = new Replies();
    const waiting = replies.wait(4);
    const outcome = expect(waiting).rejects.toThrow('no reply');
    expect(replies.has(4)).toBe(true);
    jest.advanceTimersByTime(REPLY_TIMEOUT_MS);
    await outcome;
    expect(replies.has(4)).toBe(false);
  });

  vaultIt('resolves with the result and stops the clock', async () => {
    const replies = new Replies();
    const waiting = replies.wait(4);
    replies.settle({ id: 4, result: 'done' });
    await expect(waiting).resolves.toBe('done');
    expect(replies.has(4)).toBe(false);
    jest.advanceTimersByTime(REPLY_TIMEOUT_MS);
  });

  vaultIt('rejects with the error the phone gave', async () => {
    const replies = new Replies();
    const waiting = replies.wait(4);
    replies.settle({ id: 4, error: 'unknown method: x' });
    await expect(waiting).rejects.toThrow('unknown method: x');
  });

  vaultIt('rejects every ask when the connection ends', async () => {
    const replies = new Replies();
    const one = expect(replies.wait(1)).rejects.toThrow('hung up');
    const two = expect(replies.wait(2)).rejects.toThrow('hung up');
    replies.rejectAll('hung up');
    await one;
    await two;
    expect(replies.has(1)).toBe(false);
  });
});

describe('an ask a newer one in its slot supersedes is withdrawn', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  vaultIt(
    'names the earlier ask for a cancel, rejects it as superseded and settles only the later',
    async () => {
      const replies = new Replies();
      const first = replies.wait(1);
      expect(replies.supersede('detail', 1)).toBeUndefined();
      const second = replies.wait(2);
      expect(replies.supersede('detail', 2)).toBe(1);

      const outcome = first.catch((error: unknown) => error);
      expect(isSuperseded(await outcome)).toBe(true);
      expect(replies.has(1)).toBe(false);

      replies.settle({ id: 1, result: 'late' });
      replies.settle({ id: 2, result: 'newer' });
      await expect(second).resolves.toBe('newer');
    }
  );

  vaultIt('leaves the asks of other slots and slotless asks alone', async () => {
    const replies = new Replies();
    const feed = replies.wait(1);
    const unslotted = replies.wait(2);
    replies.supersede('feed', 1);
    const detail = replies.wait(3);
    expect(replies.supersede('detail', 3)).toBeUndefined();
    expect(replies.has(1)).toBe(true);
    expect(replies.has(2)).toBe(true);
    replies.settle({ id: 1, result: 'a' });
    replies.settle({ id: 2, result: 'b' });
    replies.settle({ id: 3, result: 'c' });
    await expect(Promise.all([feed, unslotted, detail])).resolves.toEqual(['a', 'b', 'c']);
  });

  vaultIt('sends no cancel for an ask already answered, timed out or ended', async () => {
    const replies = new Replies();
    const answered = replies.wait(1);
    replies.supersede('detail', 1);
    replies.settle({ id: 1, result: 'done' });
    await answered;
    const unanswered = replies.wait(2).catch(() => undefined);
    expect(replies.supersede('detail', 2)).toBeUndefined();

    const slow = expect(replies.wait(3)).rejects.toThrow('no reply');
    jest.advanceTimersByTime(REPLY_TIMEOUT_MS);
    await slow;
    const afterTimeout = replies.wait(4).catch(() => undefined);
    expect(replies.supersede('detail', 4)).toBeUndefined();

    const ended = replies.wait(5).catch((error: unknown) => error);
    replies.supersede('map', 5);
    replies.rejectAll('hung up');
    expect(isSuperseded(await ended)).toBe(false);
    const afterEnd = replies.wait(6).catch(() => undefined);
    expect(replies.supersede('map', 6)).toBeUndefined();
    replies.rejectAll('hung up');
    await Promise.all([unanswered, afterTimeout, afterEnd]);
  });

  vaultIt('does not mistake another failure for a superseded ask', () => {
    expect(isSuperseded(new Error('busy'))).toBe(false);
    expect(isSuperseded('superseded')).toBe(false);
  });

  vaultIt('writes a cancel the engine reads, with no id of its own', () => {
    expect(JSON.parse(cancelMessage(7))).toEqual({ method: 'cancel', params: { id: 7 } });
  });
});

describe('the feed screen reads the phone summary, sparklines and a filtered page', () => {
  const listed = ['link.hello', 'feed.page', 'feed.summary', 'feed.sparklines', 'feed.highlights'];
  const none = { families: [], needle: '' };

  vaultIt('fetches the summary card, the sparklines and the first page when connected', () => {
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

  vaultIt('skips a read the phone did not list and still opens the page', () => {
    const asks = feedOpening(['link.hello', 'feed.page'], none, 5);
    expect(asks.map((ask) => ask.method)).toEqual(['feed.page']);
  });

  vaultIt('asks the page again with the chosen family and search, from the top', () => {
    const ask = feedPageAsk({ families: ['run'], needle: 'track' }, 0);
    expect(ask).toMatchObject({ offset: 0, sportFamilies: ['run'], needle: 'track' });
  });

  vaultIt('asks the page within the chosen span of start times', () => {
    const ask = feedPageAsk({ families: [], needle: '', oldestTs: 100, newestTs: 200 }, 100);
    expect(ask).toMatchObject({ offset: 100, limit: FEED_PAGE_SIZE, oldestTs: 100, newestTs: 200 });
  });

  vaultIt('drops the old rows when the first page answers, and appends a later page', () => {
    const old = [{ id: 'a' }, { id: 'b' }];
    expect(feedRows(old, [{ id: 'c' }], 0)).toEqual([{ id: 'c' }]);
    expect(feedRows(old, [{ id: 'c' }], 2)).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(feedRows(old, [], 0)).toEqual([]);
  });

  vaultIt('does not repeat a row a later page returns again', () => {
    expect(feedRows([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }], 1)).toEqual([
      { id: 'a' },
      { id: 'b' },
    ]);
  });
});

describe('the page explains a write the locked phone refused', () => {
  vaultIt('shows the unlock notice for the reply a locked phone gives a write', async () => {
    const replies = new Replies();
    const write = replies.wait(4);
    const reply = await replies.take(
      frame(4, 0, LAST, text({ id: 4, error: 'phone locked' })),
      (id) => replies.has(id)
    );
    expect(reply).toEqual({ id: 4, error: 'phone locked' });
    replies.settle(reply!);
    const error = await write.catch((e: unknown) => e);
    expect(writeNotice(error)).toBe('connectPage.notice.phoneLocked');
  });

  vaultIt('shows nothing for any other failure', () => {
    expect(writeNotice(new Error('unknown method: section.rename'))).toBeUndefined();
    expect(writeNotice(new Error('not connected'))).toBeUndefined();
    expect(writeNotice('phone locked, again')).toBeUndefined();
  });
});

describe('the page reads the previous version, whose replies are one text message each', () => {
  const asked = () => true;

  vaultIt(
    'reads a text reply before the version is agreed, as the hello of a phone on the previous version',
    async () => {
      const replies = new Replies();
      expect(
        await replies.take(
          '{"id":1,"result":{"protocol":2,"app":"0.4.1","methods":["feed.page"]}}',
          asked
        )
      ).toEqual({ id: 1, result: { protocol: 2, app: '0.4.1', methods: ['feed.page'] } });
    }
  );

  vaultIt(
    'reads text replies, and the error of one, once the page speaks the previous version',
    async () => {
      const replies = new Replies();
      replies.speak(2);
      expect(await replies.take('{"id":4,"result":[1,2]}', asked)).toEqual({
        id: 4,
        result: [1, 2],
      });
      expect(await replies.take('{"id":5,"error":"unknown method: x"}', asked)).toEqual({
        id: 5,
        error: 'unknown method: x',
      });
    }
  );

  vaultIt('ignores a text reply for an id nothing asked, and one with no numeric id', async () => {
    const replies = new Replies();
    replies.speak(2);
    expect(await replies.take('{"id":9,"result":1}', (id) => id === 1)).toBeUndefined();
    expect(await replies.take('{"id":null,"error":"malformed request"}', asked)).toBeUndefined();
  });

  vaultIt('fails every ask in flight on text that is not a JSON object', async () => {
    const replies = new Replies();
    replies.speak(2);
    const waiting = replies.wait(1);
    const outcome = expect(waiting).rejects.toBeInstanceOf(UnreadableReply);
    await replies.take('not json', asked);
    await outcome;
  });

  vaultIt('has no version until it is told one, and then speaks it', () => {
    const replies = new Replies();
    expect(replies.version).toBeNull();
    replies.speak(2);
    expect(replies.version).toBe(2);
  });
});

describe('the page keeps what the phone answered until the phone says the library changed', () => {
  const setup = () => {
    const sent: string[] = [];
    const cache = new AskCache((method, params) => {
      sent.push(`${method} ${JSON.stringify(params)}`);
      return Promise.resolve({ method });
    });
    return { sent, cache };
  };

  vaultIt('does not send a second ask for the same method and params', async () => {
    const { sent, cache } = setup();
    await cache.ask('feed.page', { offset: 0, limit: 50 });
    await cache.ask('feed.page', { limit: 50, offset: 0 });
    expect(sent).toHaveLength(1);
    await cache.ask('feed.page', { offset: 50, limit: 50 });
    expect(sent).toHaveLength(2);
  });

  vaultIt('shares one ask between two callers while it is in flight', async () => {
    const { sent, cache } = setup();
    await Promise.all([cache.ask('feed.summary', {}), cache.ask('feed.summary', {})]);
    expect(sent).toHaveLength(1);
  });

  vaultIt('asks again after a failed ask', async () => {
    let calls = 0;
    const cache = new AskCache(() =>
      ++calls === 1 ? Promise.reject(new Error('no reply')) : Promise.resolve({})
    );
    await cache.ask('feed.page', {}).catch(() => undefined);
    await cache.ask('feed.page', {});
    expect(calls).toBe(2);
  });

  vaultIt('asks lists and details again after a change, and streams and track not', async () => {
    const { sent, cache } = setup();
    await cache.ask('feed.page', { offset: 0 });
    await cache.ask('activity.summary', { id: 'a1' });
    await cache.ask('activity.streams', { id: 'a1' });
    await cache.ask('activity.track', { id: 'a1' });
    sent.length = 0;
    cache.changed();
    await cache.ask('feed.page', { offset: 0 });
    await cache.ask('activity.summary', { id: 'a1' });
    await cache.ask('activity.streams', { id: 'a1' });
    await cache.ask('activity.track', { id: 'a1' });
    expect(sent.map((line) => line.split(' ')[0])).toEqual(['feed.page', 'activity.summary']);
  });

  vaultIt('drops the streams of an activity once no list carries it', async () => {
    const { sent, cache } = setup();
    await cache.ask('activity.streams', { id: 'a1' });
    await cache.ask('activity.streams', { id: 'a2' });
    cache.keepOnly(['a2']);
    sent.length = 0;
    await cache.ask('activity.streams', { id: 'a2' });
    expect(sent).toHaveLength(0);
    await cache.ask('activity.streams', { id: 'a1' });
    expect(sent).toHaveLength(1);
  });

  vaultIt('forgets everything on clear', async () => {
    const { sent, cache } = setup();
    await cache.ask('activity.streams', { id: 'a1' });
    cache.clear();
    await cache.ask('activity.streams', { id: 'a1' });
    expect(sent).toHaveLength(2);
  });

  vaultIt('reads the changed event the phone sends under request id 0', async () => {
    const replies = new Replies();
    const reply = await replies.take(
      frame(0, 0, LAST, text({ event: 'changed', generation: 4 })),
      (id) => id === 0 || replies.has(id)
    );
    expect(reply).toBeDefined();
    expect(isChanged(reply!)).toBe(true);
    expect(isChanged({ id: 3, result: {} })).toBe(false);
    expect(isChanged({ id: 0, event: 'other' })).toBe(false);
  });
});

describe('the fitness page asks one slot per panel', () => {
  const now = new Date(2026, 2, 15, 9, 30, 0);

  vaultIt(
    're-asks the range panels for a range change and leaves best efforts and the screen alone',
    () => {
      const asks = rangeAsks(90, now);
      expect(asks.map((ask) => ask.slot)).toEqual([
        'wellness',
        'loads',
        'zones',
        'powerCurve',
        'paceCurve',
      ]);
      expect(asks.map((ask) => ask.method)).toEqual([
        'fitness.wellness',
        'fitness.loads',
        'fitness.zones',
        'fitness.powerCurve',
        'fitness.paceCurve',
      ]);
      expect(asks.some((ask) => ask.slot === bestEffortsAsk(0).slot)).toBe(false);
      expect(asks.some((ask) => ask.slot === screenAsk(now).slot)).toBe(false);
    }
  );

  vaultIt(
    'asks the days the range shows, in the wall clock the engine stores activities in',
    () => {
      const [wellness, loads, zones, power, pace] = rangeAsks(30, now);
      expect(wellness?.params).toEqual({ oldest: '2026-02-13', newest: '2026-03-15' });
      expect(loads?.params).toEqual({
        startTs: Date.UTC(2026, 1, 13) / 1000,
        endTs: Date.UTC(2026, 2, 15, 23, 59, 59) / 1000,
      });
      expect(zones?.params).toMatchObject({ sportType: 'Ride', zoneType: 'power' });
      expect(power?.params).toEqual({ sport: 'Ride', days: 30 });
      expect(pace?.params).toEqual({ sport: 'Run', days: 30, gap: false });
    }
  );

  vaultIt('asks best efforts for its own period, and the screen for the calendar windows', () => {
    expect(bestEffortsAsk(365)).toMatchObject({
      slot: 'bestEfforts',
      method: 'fitness.bestEfforts',
      params: { days: 365 },
    });
    const screen = screenAsk(now);
    expect(screen.method).toBe('fitness.screen');
    expect(screen.params).toMatchObject({
      windows: {
        heatmapLastDay: '2026-03-15',
        nowWallSeconds: Date.UTC(2026, 2, 15, 9, 30) / 1000,
      },
    });
  });

  vaultIt('lets a later ask of a slot supersede the earlier one and no other slot', () => {
    const slots = createSlots();
    const first = slots.begin('wellness');
    const loads = slots.begin('loads');
    const second = slots.begin('wellness');
    expect(slots.isCurrent('wellness', first)).toBe(false);
    expect(slots.isCurrent('wellness', second)).toBe(true);
    expect(slots.isCurrent('loads', loads)).toBe(true);
  });
});

describe('the settings screen reads the phone settings and statuses, read-only', () => {
  const listed = ['settings.get', 'settings.profile', 'status.sync', 'status.linkedDevices'];

  vaultIt('asks only for the reads the phone listed, the settings among them by key', () => {
    const asks = settingsOpening(listed);
    expect(asks.map((ask) => ask.method)).toEqual([
      'settings.get',
      'settings.profile',
      'status.linkedDevices',
      'status.sync',
    ]);
    expect(asks[0].params).toEqual({ keys: SETTING_LABELS.map(([key]) => key) });
    expect(settingsOpening(['link.hello'])).toEqual([]);
  });

  vaultIt('shows each value the phone holds and no control is enabled', () => {
    const rows = settingRows({
      values: [
        { key: 'veloq-unit-preference', value: 'imperial' },
        { key: 'veloq-theme-preference', value: null },
        { key: 'not-a-known-key', value: 'x' },
      ],
      refused: [],
    });
    expect(rows).toEqual([
      {
        key: 'veloq-theme-preference',
        label: 'connectPage.settings.values.theme',
        value: null,
        editable: false,
      },
      {
        key: 'veloq-unit-preference',
        label: 'connectPage.settings.values.units',
        value: 'imperial',
        editable: false,
      },
    ]);
    expect(rows.every((row) => row.editable === false)).toBe(true);
    expect(settingRows(undefined)).toEqual([]);
  });

  vaultIt('cuts a long stored value', () => {
    const [row] = settingRows({
      values: [{ key: 'veloq-map-preferences', value: 'x'.repeat(500) }],
      refused: [],
    });
    expect(row.value?.length).toBeLessThan(200);
  });

  vaultIt('marks the browser that is reading among the linked devices', () => {
    const device = (id: string, name: string) => ({
      id,
      name,
      createdAt: 1,
      lastSeenAt: null,
      connectedSince: null,
    });
    expect(
      deviceLines({ devices: [device('1', 'Laptop'), device('2', 'Desk')], thisBrowser: '2' })
    ).toEqual([
      { name: 'Laptop', thisBrowser: false },
      { name: 'Desk', thisBrowser: true },
    ]);
  });
});

describe('the strength tab and the wall clock the page asks with', () => {
  vaultIt('reads the span of days each period names, and the week for an unknown one', () => {
    expect(strengthPeriodDays('7d')).toBe(7);
    expect(strengthPeriodDays('1m')).toBe(30);
    expect(strengthPeriodDays('3m')).toBe(90);
    expect(strengthPeriodDays('6m')).toBe(180);
    expect(strengthPeriodDays('1y')).toBe(365);
    expect(strengthPeriodDays(null)).toBe(7);
    expect(strengthPeriodDays('forever')).toBe(7);
  });

  vaultIt('shifts the instant by the zone offset, so it reads the local wall clock', () => {
    const instant = Date.UTC(2026, 10, 12, 9, 30, 0);
    expect(wallSeconds(instant, 0)).toBe(instant / 1000);
    // A zone one hour ahead of UTC reports an offset of -60 minutes.
    expect(wallSeconds(instant, -60)).toBe(instant / 1000 + 3600);
    expect(wallSeconds(instant, 300)).toBe(instant / 1000 - 18000);
  });
});

describe('the page acts on the phone saying why it is leaving', () => {
  vaultIt(
    'goes to waiting at once with the reason, hanging up and retrying, when the phone leaves',
    () => {
      for (const reason of ['background', 'switchedOff', 'disconnected'] as const) {
        const next = step(connected(), { type: 'farewell', reason });
        expect(next.state).toEqual({ name: 'waiting', phone: PHONE, attempt: 1, reason });
        expect(next.effects).toEqual([{ do: 'hangUp' }, { do: 'retry', delay: retryDelay(0) }]);
      }
    }
  );

  it('forgets the phone and pairs afresh when it was removed on the phone', () => {
    const next = step(connected(), { type: 'farewell', reason: 'removed' });
    expect(next.state).toEqual({ name: 'unpaired', notice: 'removed' });
    expect(doing(next)).toEqual(['hangUp', 'forget', 'invite']);
  });

  vaultIt('treats a declined pairing as the phone declining', () => {
    const confirming: State = {
      name: 'confirming',
      invitation: { room: 'room-0123456789abcdefghij', secret: SEVENS, exp: 2000 },
      phone: PHONE,
    };
    const next = step(confirming, { type: 'farewell', reason: 'declined' });
    expect(next.state).toEqual({ name: 'unpaired', notice: 'declined' });
    expect(doing(next)).toEqual(['hangUp', 'invite']);
  });

  vaultIt('changes nothing for a farewell that arrives while already waiting', () => {
    const waiting: State = { name: 'waiting', phone: PHONE, attempt: 3, reason: 'background' };
    const next = step(waiting, { type: 'farewell', reason: 'removed' });
    expect(next.state).toEqual(waiting);
    expect(next.effects).toEqual([]);
  });

  vaultIt('forgets the reason once the phone is back', () => {
    const waiting: State = { name: 'waiting', phone: PHONE, attempt: 1, reason: 'background' };
    const next = step(waiting, { type: 'peer' });
    expect(next.state).toEqual({ name: 'connecting', phone: PHONE, attempt: 1 });
  });

  vaultIt('keeps the reason through a failed retry while the phone stays away', () => {
    const waiting: State = { name: 'waiting', phone: PHONE, attempt: 1, reason: 'background' };
    expect(step(waiting, { type: 'drop' }).state).toMatchObject({ reason: 'background' });
    expect(step(waiting, { type: 'relayClosed' }).state).toMatchObject({ reason: 'background' });
  });

  vaultIt('reads a farewell off the channel under request id 0, and nothing else', async () => {
    const read = async (id: number, body: object) => {
      const replies = new Replies();
      const reply = await replies.take(frame(id, 0, LAST, text(body)), () => true);
      return farewellOf(reply!);
    };
    expect(await read(0, { event: 'farewell', reason: 'background' })).toBe('background');
    expect(await read(0, { event: 'farewell', reason: 'switchedOff' })).toBe('switchedOff');
    expect(await read(0, { event: 'farewell', reason: 'somethingNew' })).toBeUndefined();
    expect(await read(0, { event: 'farewell' })).toBeUndefined();
    expect(await read(0, { event: 'changed', generation: 2 })).toBeUndefined();
    expect(
      await read(1, { id: 1, result: { event: 'farewell', reason: 'removed' } })
    ).toBeUndefined();
    expect(farewellOf({ id: 1, result: 5 })).toBeUndefined();
  });
});
