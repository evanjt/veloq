// The connect page's browser side without a screen: the relay socket, the
// WebRTC connection, the kept certificate and the effects `step` asks for.
// Every browser API it reaches is in the environment it is given, so a test
// stands in for each. What is drawn reads `get` and listens through
// `subscribe`.

import { createClient, type Client } from './client';
import { browserKeys, type Keys } from './keys';
import {
  INVITATION_TTL_SECS,
  PAGE_NAME,
  PAGE_PROTOCOL,
  answerFingerprint,
  base64url,
  feedOpening,
  feedPageAsk,
  feedRows,
  invitation as invitationText,
  normaliseFingerprint,
  peerConfiguration,
  proof,
  proofsMatch,
  roomFor,
  step,
  withoutHiddenCandidates,
  writeNotice,
  type Effect,
  type Event,
  type FeedFilter,
  type State,
} from './link';
import type { Methods } from './schema';
import { createStore } from './store';

const RELAY = 'wss://auth.veloq.fit/link/';
const STATUS_POLL_MS = 1000;
const GATHER_LIMIT_MS = 3000;
/** A phone that refuses a browser stays silent, so an unanswered offer counts as a drop. */
const ANSWER_LIMIT_MS = 15000;
/** About a year. A browser whose certificate runs out links again. */
const CERTIFICATE_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

/** What the phone serves for one activity in the list. */
export type Card = {
  id: string;
  name: string;
  startDateLocal?: string;
  sportType?: string;
  distance?: number | null;
  movingTime?: number | null;
  elevationGain?: number | null;
  avgHr?: number | null;
  avgPower?: number | null;
  trainingLoad?: number | null;
};

/** What the phone serves for one activity's summary. */
export type Detail = {
  id: string;
  movingTime?: number | null;
  elapsedTime?: number | null;
  averageSpeed?: number | null;
  maxSpeed?: number | null;
};

export type Summary = Methods['feed.summary']['result'];
export type Sparklines = Methods['feed.sparklines']['result'];

/** Every browser API the session reaches. */
export interface Environment {
  WebSocket: typeof WebSocket;
  RTCPeerConnection: typeof RTCPeerConnection;
  generateCertificate: () => Promise<RTCCertificate>;
  /** Milliseconds since the epoch. */
  now: () => number;
  /** Minutes the local clock is behind UTC, as `Date.prototype.getTimezoneOffset` gives. */
  timezoneOffset: () => number;
  setTimeout: (work: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
  keys: Keys;
  userAgent: string;
  /** Logs the room's inputs to the console. */
  debug: boolean;
}

/** The environment of the window the page runs in. */
export function browserEnvironment(): Environment {
  return {
    WebSocket,
    RTCPeerConnection,
    generateCertificate: () =>
      RTCPeerConnection.generateCertificate({
        name: 'ECDSA',
        namedCurve: 'P-256',
        expires: CERTIFICATE_LIFETIME_MS,
      } as AlgorithmIdentifier),
    now: () => Date.now(),
    timezoneOffset: () => new Date().getTimezoneOffset(),
    setTimeout: (work, ms) => setTimeout(work, ms),
    clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    keys: browserKeys,
    userAgent: navigator.userAgent,
    debug: new URLSearchParams(location.search).has('debug'),
  };
}

/** What is drawn. A new object on every change. */
export type Snapshot = {
  state: State;
  /** The text of the link code on screen, or null before one is made. */
  code: string | null;
  feed: Card[] | null;
  /** Whether the phone holds more cards past those listed. */
  feedMore: boolean;
  /** The chips and search text the feed is narrowed by. */
  filter: FeedFilter;
  /** The week's totals and wellness headlines above the list. */
  summary: Summary | null;
  sparklines: Sparklines | null;
  /** The chips under each card, by card id. */
  highlights: Readonly<Record<string, string[]>>;
  details: Readonly<Record<string, Detail>>;
  /** Why the phone refused the last write, such as being locked; null once a write goes through. */
  writeNotice: string | null;
  /** The browser could not start: no certificate, or no WebRTC. */
  failed: boolean;
};

export interface Session {
  subscribe: (listener: () => void) => () => void;
  get: () => Snapshot;
  dispatch: (event: Event) => void;
  /** Read the kept certificate and phone, then start the machine. */
  start: () => Promise<void>;
  /** Forget the paired phone and pair afresh. */
  unlink: () => void;
  /** Ask for an activity's summary, once per connection, when the phone lists the method. */
  requestDetail: (id: string) => void;
  /** Narrow the feed and read it again from the top. */
  setFilter: (filter: FeedFilter) => void;
  /** Read the next page of the feed, if the phone holds one and none is loading. */
  loadMore: () => void;
  /**
   * Ask the phone a write. A phone that is locked refuses it, and the athlete is
   * told why; the page holds nothing from a write that was not made.
   */
  write: <M extends keyof Methods>(
    method: M,
    params: Methods[M]['params']
  ) => Promise<Methods[M]['result']>;
}

export function createSession(env: Environment): Session {
  let snapshot: Snapshot = {
    state: { name: 'unpaired' },
    code: null,
    feed: null,
    feedMore: false,
    filter: { families: [], needle: '' },
    summary: null,
    sparklines: null,
    highlights: {},
    details: {},
    writeNotice: null,
    failed: false,
  };
  const listeners = new Set<() => void>();
  /** Bumped on every hang-up, so a callback from an old connection does nothing. */
  let generation = 0;
  const screens = createStore();
  const asked = new Set<string>();
  let socket: WebSocket | null = null;
  let peer: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let client: Client | null = null;
  let timers: unknown[] = [];
  let certificate: RTCCertificate;
  let browserFingerprint = '';
  let secret: Uint8Array<ArrayBuffer> | null = null;
  /** Bumped on every filter change, so a page asked under an old filter is dropped. */
  let feedGeneration = 0;
  let feedLoading = false;

  const change = (next: Partial<Snapshot>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of [...listeners]) listener();
  };

  /** Move the screens' data into the snapshot. */
  const publishScreens = () => {
    const feed = (screens.get('feed', generation) as Card[] | undefined) ?? null;
    const feedMore = screens.get('feedMore', generation) === true;
    const summary = (screens.get('summary', generation) as Summary | undefined) ?? null;
    const sparklines = (screens.get('sparklines', generation) as Sparklines | undefined) ?? null;
    const highlights =
      (screens.get('highlights', generation) as Record<string, string[]> | undefined) ?? {};
    const details: Record<string, Detail> = {};
    for (const id of asked) {
      const detail = screens.get(`activity:${id}`, generation) as Detail | undefined;
      if (detail) details[id] = detail;
    }
    change({ feed, feedMore, summary, sparklines, highlights, details });
  };

  function dispatch(event: Event) {
    const result = step(snapshot.state, event);
    change({ state: result.state });
    for (const effect of result.effects) void run(effect);
  }

  async function run(effect: Effect) {
    switch (effect.do) {
      case 'invite':
        invite();
        break;
      case 'joinLinked':
        await join(await linkedRoom(effect.phone));
        break;
      case 'offer':
        await offer();
        break;
      case 'prove':
        await prove();
        break;
      case 'pollStatus':
        later(STATUS_POLL_MS, async () => {
          try {
            const value = await client?.askPairing('pair.status');
            dispatch({ type: 'status', value: String(value) });
          } catch {
            dispatch({ type: 'drop' });
          }
        });
        break;
      case 'remember':
        await env.keys.write('phone', effect.phone);
        break;
      case 'forget':
        await env.keys.drop('phone');
        break;
      case 'leaveRelay':
        leaveRelay();
        break;
      case 'hello':
        await hello();
        break;
      case 'fetchFeed':
        await fetchFeed();
        break;
      case 'ask':
        await answerScreen(effect.method, effect.params);
        break;
      case 'hangUp':
        hangUp();
        break;
      case 'rejoin':
        later(effect.delay, async () => {
          if (snapshot.state.name === 'inviting') await join(effect.room);
        });
        break;
      case 'retry':
        later(effect.delay, async () => {
          const { state } = snapshot;
          if (state.name === 'waiting') await join(await linkedRoom(state.phone));
        });
        break;
    }
  }

  async function keptCertificate(): Promise<RTCCertificate> {
    const kept = await env.keys.read<RTCCertificate>('certificate');
    if (kept && kept.expires > env.now()) return kept;
    const made = await env.generateCertificate();
    await env.keys.write('certificate', made);
    await env.keys.drop('phone');
    return made;
  }

  /** The certificate's fingerprint, read from an offer where the browser cannot list it. */
  async function fingerprintOf(cert: RTCCertificate) {
    const listed = cert.getFingerprints?.().find((entry) => entry.algorithm === 'sha-256');
    if (listed?.algorithm && listed.value)
      return normaliseFingerprint(listed.algorithm, listed.value);
    const probe = new env.RTCPeerConnection({ certificates: [cert] });
    probe.createDataChannel('probe');
    const offer = await probe.createOffer();
    probe.close();
    const found = answerFingerprint(offer.sdp ?? '');
    if (!found) throw new Error('no certificate fingerprint');
    return found;
  }

  /** The room shared with a linked phone. With `debug`, the inputs go to this console only. */
  async function linkedRoom(phone: string) {
    const room = await roomFor(browserFingerprint, phone);
    if (env.debug) console.warn('link room', { room, browser: browserFingerprint, phone });
    return room;
  }

  /** Run `work` after `ms`, unless the connection is hung up first. */
  function later(ms: number, work: () => unknown) {
    const mine = generation;
    timers.push(
      env.setTimeout(() => {
        if (mine === generation) void work();
      }, ms)
    );
  }

  function invite() {
    const room = base64url(crypto.getRandomValues(new Uint8Array(16)));
    secret = crypto.getRandomValues(new Uint8Array(32));
    const now = Math.floor(env.now() / 1000);
    change({ code: invitationText({ room, secret, fp: browserFingerprint, now }) });
    dispatch({
      type: 'invited',
      invitation: { room, secret, exp: now + INVITATION_TTL_SECS },
    });
    void join(room);
    later(INVITATION_TTL_SECS * 1000, () => dispatch({ type: 'expired' }));
  }

  /** Wait in a relay room for the phone. */
  async function join(room: string) {
    socket?.close();
    const mine = generation;
    const opened = new env.WebSocket(RELAY + room);
    socket = opened;
    opened.onmessage = async ({ data }) => {
      if (mine !== generation || typeof data !== 'string') return;
      let message;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }
      if (message.type === 'peer') dispatch({ type: 'peer' });
      else if (message.type === 'answer' && peer) {
        await peer.setRemoteDescription(message);
        if (mine === generation)
          dispatch({ type: 'answered', fingerprint: answerFingerprint(message.sdp) });
      } else if (message.type === 'bye') {
        dispatch({ type: 'bye' });
      }
    };
    opened.onclose = () => {
      if (mine !== generation || socket !== opened) return;
      socket = null;
      dispatch({ type: 'relayClosed' });
    };
  }

  /**
   * Close the relay socket once the channel carries the session. The socket is
   * cleared first, so its close is not read as a drop: the guard in `join`
   * sees a socket that is no longer the current one.
   */
  function leaveRelay() {
    const left = socket;
    socket = null;
    left?.close();
  }

  async function offer() {
    peer?.close();
    const mine = generation;
    const made = new env.RTCPeerConnection(peerConfiguration(certificate));
    peer = made;
    const opened = made.createDataChannel('veloq');
    channel = opened;
    client = createClient(opened, () => mine === generation && dispatch({ type: 'mismatch' }));
    opened.onopen = () => mine === generation && dispatch({ type: 'open' });
    opened.onclose = () => mine === generation && dispatch({ type: 'drop' });
    made.onconnectionstatechange = () => {
      if (mine === generation && made.connectionState === 'failed') dispatch({ type: 'drop' });
    };

    await made.setLocalDescription(await made.createOffer());
    await gathered(made);
    if (mine !== generation || !made.localDescription) return;
    socket?.send(
      JSON.stringify({ type: 'offer', sdp: withoutHiddenCandidates(made.localDescription.sdp) })
    );
    later(ANSWER_LIMIT_MS, () => {
      if (peer === made && !made.remoteDescription) dispatch({ type: 'drop' });
    });
  }

  /** The phone takes no trickled candidates, so the offer waits for all of them. */
  function gathered(connection: RTCPeerConnection) {
    return new Promise<void>((resolve) => {
      const done = () => resolve();
      if (connection.iceGatheringState === 'complete') {
        done();
      } else {
        connection.addEventListener('icegatheringstatechange', () => {
          if (connection.iceGatheringState === 'complete') done();
        });
        env.setTimeout(done, GATHER_LIMIT_MS);
      }
    });
  }

  async function prove() {
    const { state } = snapshot;
    if (state.name !== 'proving' || !secret || !client) return;
    const phone = state.phone;
    const mine = proof(secret, 'browser', browserFingerprint, phone);
    const expected = proof(secret, 'phone', browserFingerprint, phone);
    try {
      const reply = (await client.askPairing('pair.prove', {
        proof: await mine,
        name: browserName(env.userAgent),
      })) as { phoneProof?: string };
      const ok =
        typeof reply.phoneProof === 'string' && proofsMatch(reply.phoneProof, await expected);
      dispatch({ type: 'proved', ok });
    } catch {
      dispatch({ type: 'proved', ok: false });
    }
  }

  /** The first thing asked on an open channel: what the phone speaks. */
  async function hello() {
    const mine = generation;
    try {
      const answer = await client?.ask('link.hello', { protocol: PAGE_PROTOCOL, page: PAGE_NAME });
      if (answer && mine === generation) {
        dispatch({ type: 'hello', protocol: answer.protocol, methods: answer.methods });
      }
    } catch {
      if (mine === generation) dispatch({ type: 'drop' });
    }
  }

  /** The summary card, the sparklines and the first page, each stored as it answers. */
  async function fetchFeed() {
    const mine = generation;
    const { state } = snapshot;
    const methods = state.name === 'connected' ? (state.methods ?? []) : [];
    const nowWallSeconds = env.now() / 1000 - env.timezoneOffset() * 60;
    try {
      await Promise.all(
        feedOpening(methods, snapshot.filter, nowWallSeconds).map(async (opening) => {
          if (opening.method === 'feed.summary') {
            const card = await client?.ask(
              'feed.summary',
              opening.params as Methods['feed.summary']['params']
            );
            if (card && screens.put('summary', mine, card)) publishScreens();
          } else if (opening.method === 'feed.sparklines') {
            const lines = await client?.ask(
              'feed.sparklines',
              opening.params as Methods['feed.sparklines']['params']
            );
            if (lines !== undefined && screens.put('sparklines', mine, lines)) publishScreens();
          } else {
            await loadFeedPage(0, mine, feedGeneration);
          }
        })
      );
    } catch {
      if (mine === generation) dispatch({ type: 'drop' });
    }
  }

  /** Ask the page at `offset` under the current filter and keep it unless the filter moved on. */
  async function loadFeedPage(offset: number, mine = generation, asked = feedGeneration) {
    if (!client) throw new Error('not connected');
    const page = await client.ask('feed.page', feedPageAsk(snapshot.filter, offset));
    if (asked !== feedGeneration) return;
    const held = offset === 0 ? [] : ((screens.get('feed', mine) as Card[] | undefined) ?? []);
    const rows = feedRows(held, page.cards as Card[], offset);
    if (!screens.put('feed', mine, rows)) return;
    screens.put('feedMore', mine, page.hasMore);
    publishScreens();
    await loadHighlights(
      page.cards.map((card) => card.id),
      mine,
      asked
    );
  }

  /** The chips under the cards of a page, if the phone answers them. */
  async function loadHighlights(ids: string[], mine: number, asked: number) {
    const { state } = snapshot;
    if (
      ids.length === 0 ||
      state.name !== 'connected' ||
      !state.methods?.includes('feed.highlights')
    )
      return;
    try {
      const bundle = await client?.ask('feed.highlights', { ids });
      if (!bundle || asked !== feedGeneration) return;
      const held = (screens.get('highlights', mine) as Record<string, string[]> | undefined) ?? {};
      const next = { ...held };
      for (const id of ids) next[id] = [];
      for (const route of bundle.routeHighlights)
        next[route.activityId]?.push(route.isPr ? `${route.routeName} PR` : route.routeName);
      for (const indicator of bundle.indicators)
        next[indicator.activityId]?.push(`${indicator.targetName} ${indicator.indicatorType}`);
      if (screens.put('highlights', mine, next)) publishScreens();
    } catch {
      // The cards stay without chips.
    }
  }

  /** Send the ask a screen needs, now that the machine has found the phone lists it. */
  async function answerScreen(method: string, params: object) {
    const mine = generation;
    try {
      if (method === 'activity.summary') {
        const { id } = params as { id: string };
        const summary = { id, ...(await client?.ask('activity.summary', { id })) };
        if (screens.put(`activity:${id}`, mine, summary)) publishScreens();
      }
    } catch {
      // The list stays usable; a summary that failed is simply not shown.
    }
  }

  function hangUp() {
    generation++;
    for (const timer of timers) env.clearTimeout(timer);
    timers = [];
    client?.hangUp();
    channel?.close();
    peer?.close();
    socket?.close();
    client = null;
    channel = null;
    peer = null;
    socket = null;
    screens.clear(generation);
    asked.clear();
    feedLoading = false;
    change({
      code: null,
      feed: null,
      feedMore: false,
      summary: null,
      sparklines: null,
      highlights: {},
      details: {},
    });
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    get: () => snapshot,
    dispatch,
    async start() {
      try {
        certificate = await keptCertificate();
        browserFingerprint = await fingerprintOf(certificate);
        const phone = await env.keys.read<string>('phone');
        dispatch({ type: 'start', phone: phone ?? null });
      } catch {
        change({ failed: true });
      }
    },
    unlink: () => dispatch({ type: 'forget' }),
    requestDetail(id) {
      const { state } = snapshot;
      if (state.name !== 'connected' || state.methods === null) return;
      if (asked.has(id)) return;
      asked.add(id);
      dispatch({ type: 'screen', method: 'activity.summary', params: { id } });
    },
    setFilter(filter) {
      feedGeneration++;
      change({ filter });
      if (snapshot.state.name !== 'connected') return;
      const mine = generation;
      screens.put('feed', mine, []);
      screens.put('feedMore', mine, false);
      publishScreens();
      void loadFeedPage(0).catch(() => {
        if (mine === generation) dispatch({ type: 'drop' });
      });
    },
    loadMore() {
      if (feedLoading || !snapshot.feedMore || snapshot.state.name !== 'connected') return;
      feedLoading = true;
      const mine = generation;
      loadFeedPage(snapshot.feed?.length ?? 0)
        .catch(() => undefined)
        .finally(() => {
          if (mine === generation) feedLoading = false;
        });
    },
    async write(method, params) {
      if (!client) throw new Error('not connected');
      try {
        const result = (await client.ask(method, params)) as Methods[typeof method]['result'];
        if (snapshot.writeNotice !== null) change({ writeNotice: null });
        return result;
      } catch (error) {
        const text = writeNotice(error);
        if (text !== undefined) change({ writeNotice: text });
        throw error;
      }
    },
  };
}

/** What the phone lists this browser as. */
export function browserName(agent: string) {
  const browser = /Firefox\//.test(agent)
    ? 'Firefox'
    : /Edg\//.test(agent)
      ? 'Edge'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'Browser';
  const system = /Windows/.test(agent)
    ? 'Windows'
    : /Mac OS X/.test(agent)
      ? 'macOS'
      : /Linux/.test(agent)
        ? 'Linux'
        : '';
  return system ? `${browser} on ${system}` : browser;
}
