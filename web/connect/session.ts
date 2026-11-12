// The connect page's browser side without a screen: the relay socket, the
// WebRTC connection, the kept certificate and the effects `step` asks for.
// Every browser API it reaches is in the environment it is given, so a test
// stands in for each. What is drawn reads `get` and listens through
// `subscribe`.

import type { ParseKeys } from 'i18next';

import { factsOf, type Facts, type StatRow } from './connection';
import { DETAIL_SLOTS, DETAIL_STREAM_TYPES } from './activity';
import { createClient, type Client } from './client';
import {
  BEST_EFFORT_PERIODS,
  RANGES,
  bestEffortsAsk,
  createSlots,
  rangeAsks,
  screenAsk,
  type PanelAsk,
} from './fitness';
import {
  INSIGHT_SETTING_KEYS,
  INSIGHTS_PARTS_KEY,
  insightsAsk,
  insightsSettings,
  type InsightsParts,
} from './insights';
import { browserKeys, type Keys } from './keys';
import {
  AskCache,
  INVITATION_TTL_SECS,
  PAGE_MIN_PROTOCOL,
  PAGE_NAME,
  PAGE_PROTOCOL,
  answerFingerprint,
  base64url,
  feedOpening,
  feedPageAsk,
  feedRows,
  invitation as invitationText,
  isSuperseded,
  normaliseFingerprint,
  olderPage,
  peerConfiguration,
  proof,
  proofsMatch,
  roomFor,
  settingsOpening,
  step,
  wallSeconds,
  withoutHiddenCandidates,
  writeNotice,
  type Build,
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
  /** Whether the activity recorded a track. */
  hasGps?: boolean;
  distance?: number | null;
  movingTime?: number | null;
  elevationGain?: number | null;
  avgHr?: number | null;
  avgPower?: number | null;
  trainingLoad?: number | null;
};

/** The reads of one activity's detail pane, each present once it has answered. */
export type ActivityParts = {
  streams?: Methods['activity.streams']['result'];
  laps?: Methods['activity.intervals']['result'];
  data?: Methods['activity.detail']['result'];
};

/** The key an activity's detail reads are kept under in `Snapshot.screens`. */
export const activityParts = (id: string) => `activity-parts:${id}`;

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

/** The reads the settings screen shows, each kept by its method once it answers. */
export type SettingsReads = {
  [
    M in
      | 'settings.get'
      | 'settings.profile'
      | 'status.backgroundJobs'
      | 'status.cache'
      | 'status.backup'
      | 'status.linkedDevices'
      | 'status.coverage'
      | 'status.sync'
  ]?: Methods[M]['result'];
};

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
  /** The page builds kept online beside this one, or none when the list cannot be read. */
  builds: () => Promise<Build[]>;
  /** Leave this page for the one at `path`, relative to this page's own address. */
  navigate: (path: string) => void;
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
    builds: async () => {
      const listed = await fetch('builds.json', { cache: 'no-store' });
      return listed.ok ? ((await listed.json()) as Build[]) : [];
    },
    navigate: (path) => location.assign(new URL(path, location.href).href),
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
  /** Each card's preview line from the phone, base64, by card id. A card without GPS has none. */
  previews: Readonly<Record<string, string>>;
  details: Readonly<Record<string, Detail>>;
  /**
   * The answers of the screens asked through `request`, each under the key it
   * was asked by, such as `strength:7` or `recording:<id>`.
   */
  screens: Readonly<Record<string, unknown>>;
  /** The settings, profile and statuses the settings screen shows, read-only. */
  settings: Readonly<SettingsReads>;
  /**
   * The fitness page's panels by slot: the phone's answer, or `failed` when it
   * could not answer. A slot asked again keeps its last answer until the new one.
   */
  fitness: Readonly<Record<string, { answer: unknown } | 'failed'>>;
  /** The days the fitness page's range control reads. */
  fitnessRange: number;
  /** The sport the fitness page's zone and curve panels read. */
  fitnessSport: string;
  /** The days the best efforts read, 0 for all time. */
  bestEffortDays: number;
  /** Why the phone refused the last write, such as being locked; null once a write goes through. */
  writeNotice: ParseKeys | null;
  /**
   * How many times on this connection the phone said its library changed. A
   * screen asks its reads again when it moves; the lists and details held are
   * dropped from the cache, so the asks reach the phone.
   */
  libraryChanges: number;
  /** The browser could not start: no certificate, or no WebRTC. */
  failed: boolean;
  /** When the connection opened, on the browser's clock; null unless connected. */
  connectedSince: number | null;
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
  /**
   * Ask for an activity's whole detail: the screen data, the series and the
   * laps, kept under `activityParts(id)`. Each read has its own slot, so
   * opening another ride withdraws the first one's reads.
   */
  requestActivityParts: (id: string) => void;
  /**
   * Ask for one screen's data, once per connection, kept under `key`. The ask
   * goes only if the phone's hello listed the method.
   */
  request: <M extends keyof Methods>(key: string, method: M, params: Methods[M]['params']) => void;
  /** Ask for the strength screen over the period of `periodDays`, kept as `strength:<days>`. */
  requestStrength: (periodDays: number) => void;
  /** Ask for the settings screen's reads, once per connection. */
  requestSettings: () => void;
  /**
   * Ask for the insights page's reads, once per connection: the settings its
   * cards depend on, then the bundle over the windows those settings choose.
   * Kept under `INSIGHTS_PARTS_KEY`.
   */
  requestInsights: () => void;
  /** Ask every fitness panel, once per connection. */
  requestFitness: () => void;
  /** Read the panels that follow the range over `days`. */
  setFitnessRange: (days: number) => void;
  /** Read the zone and curve panels for another sport. */
  setFitnessSport: (sport: string) => void;
  /** Read the best efforts over `days`, 0 for all time. */
  setBestEffortDays: (days: number) => void;
  /** Narrow the feed and read it again from the top. */
  setFilter: (filter: FeedFilter) => void;
  /** The path, round trip and traffic of the open connection, from the browser's own stats. */
  connectionFacts: () => Promise<Facts | null>;
  /** Read the next page of the feed, if the phone holds one and none is loading. */
  loadMore: () => void;
  /**
   * Ask the phone a read by name, for the map's sources, which name methods the
   * schema does not list until the screens that use them land.
   */
  read: (method: string, params: object) => Promise<unknown>;
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
    previews: {},
    details: {},
    screens: {},
    settings: {},
    fitness: {},
    fitnessRange: RANGES[1],
    fitnessSport: 'Ride',
    bestEffortDays: BEST_EFFORT_PERIODS[0],
    writeNotice: null,
    libraryChanges: 0,
    failed: false,
    connectedSince: null,
  };
  const listeners = new Set<() => void>();
  /** Bumped on every hang-up, so a callback from an old connection does nothing. */
  let generation = 0;
  const screens = createStore();
  const asked = new Set<string>();
  /** What the phone answered on this connection, dropped on its word that the library changed. */
  const cache = new AskCache((method, params, slot) =>
    client
      ? client.ask(method as keyof Methods, params as never, slot)
      : Promise.reject(new Error('not connected'))
  );
  /**
   * A read of the link protocol, answered from the cache when it holds the
   * ask. A `slot` withdraws the read still outstanding in it, as the client does.
   */
  const read = <M extends keyof Methods>(method: M, params: Methods[M]['params'], slot?: string) =>
    cache.ask(method, params, slot) as Promise<Methods[M]['result']>;
  const slots = createSlots();
  /** The key each screen ask sent through the machine is kept under, by its method and params. */
  const keyed = new Map<string, string>();
  const askKey = (method: string, params: object) => `${method} ${JSON.stringify(params)}`;
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
    const previews =
      (screens.get('previews', generation) as Record<string, string> | undefined) ?? {};
    const details: Record<string, Detail> = {};
    for (const id of asked) {
      const detail = screens.get(`activity:${id}`, generation) as Detail | undefined;
      if (detail) details[id] = detail;
    }
    const settings = (screens.get('settings', generation) as SettingsReads | undefined) ?? {};
    const shown: Record<string, unknown> = {};
    for (const key of keyed.values()) {
      const answer = screens.get(key, generation);
      if (answer !== undefined) shown[key] = answer;
    }
    change({
      feed,
      feedMore,
      summary,
      sparklines,
      highlights,
      previews,
      details,
      screens: shown,
      settings,
    });
  };

  function dispatch(event: Event) {
    const result = step(snapshot.state, event);
    const { connectedSince } = snapshot;
    const since =
      result.state.name !== 'connected'
        ? null
        : snapshot.state.name === 'connected'
          ? connectedSince
          : env.now();
    change({ state: result.state, connectedSince: since });
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
      case 'speak':
        client?.speak(effect.version);
        break;
      case 'redirect':
        await redirect(effect.protocol);
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
    opened.onopen = () => {
      if (mine !== generation || socket !== opened) return;
      dispatch({ type: 'relayOpened' });
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
    client = createClient(
      opened,
      () => mine === generation && dispatch({ type: 'mismatch' }),
      () => mine === generation && refresh(),
      (reason) => mine === generation && dispatch({ type: 'farewell', reason })
    );
    opened.onopen = () => mine === generation && dispatch({ type: 'open' });
    opened.onclose = () => mine === generation && dispatch({ type: 'drop' });
    made.onconnectionstatechange = () => {
      if (mine !== generation || made.connectionState !== 'failed') return;
      // The phone's answer arrived, so the relay and the phone are fine and only the path failed.
      dispatch(made.remoteDescription ? { type: 'drop', cause: 'unreachable' } : { type: 'drop' });
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
      const answer = await client?.ask('link.hello', {
        protocol: PAGE_PROTOCOL,
        minProtocol: PAGE_MIN_PROTOCOL,
        page: PAGE_NAME,
      });
      if (answer && mine === generation) {
        dispatch({
          type: 'hello',
          protocol: answer.protocol,
          // A phone on a build before ranges names none, and its one version is the whole of it.
          minProtocol: answer.minProtocol,
          maxProtocol: answer.maxProtocol,
          methods: answer.methods,
          device: answer.device,
        });
      }
    } catch {
      if (mine === generation) dispatch({ type: 'drop' });
    }
  }

  /**
   * Go to the kept build of the page that speaks a phone's version, when there
   * is one. A list that cannot be read, or holds none, leaves the update notice.
   */
  async function redirect(protocol: number) {
    const mine = generation;
    try {
      const path = olderPage(await env.builds(), protocol, PAGE_PROTOCOL);
      if (path !== null && mine === generation) env.navigate(path);
    } catch {
      // The notice already on screen stands.
    }
  }

  /** The summary card, the sparklines and the first page, each stored as it answers. */
  async function fetchFeed() {
    const mine = generation;
    const { state } = snapshot;
    const methods = state.name === 'connected' ? (state.methods ?? []) : [];
    const nowWallSeconds = wallSeconds(env.now(), env.timezoneOffset());
    try {
      await Promise.all(
        feedOpening(methods, snapshot.filter, nowWallSeconds).map(async (opening) => {
          if (opening.method === 'feed.summary') {
            const card = await read(
              'feed.summary',
              opening.params as Methods['feed.summary']['params']
            );
            if (card && screens.put('summary', mine, card)) publishScreens();
          } else if (opening.method === 'feed.sparklines') {
            const lines = await read(
              'feed.sparklines',
              opening.params as Methods['feed.sparklines']['params']
            );
            if (lines !== undefined && screens.put('sparklines', mine, lines)) publishScreens();
          } else {
            await loadFeedPage(0, mine, feedGeneration);
          }
        })
      );
    } catch (error) {
      if (mine === generation && !isSuperseded(error)) dispatch({ type: 'drop' });
    }
  }

  /** Ask the page at `offset` under the current filter and keep it unless the filter moved on. */
  async function loadFeedPage(offset: number, mine = generation, asked = feedGeneration) {
    if (!client) throw new Error('not connected');
    const page = await read('feed.page', feedPageAsk(snapshot.filter, offset), 'feed');
    if (asked !== feedGeneration) return;
    const held = offset === 0 ? [] : ((screens.get('feed', mine) as Card[] | undefined) ?? []);
    const rows = feedRows(held, page.cards as Card[], offset);
    if (!screens.put('feed', mine, rows)) return;
    const heldLines =
      offset === 0 ? {} : ((screens.get('previews', mine) as Record<string, string>) ?? {});
    const lines = { ...heldLines };
    for (const preview of page.previews) lines[preview.activityId] = preview.encodedCoords;
    screens.put('previews', mine, lines);
    cache.keepOnly(rows.map((row) => row.id));
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
      const bundle = await read('feed.highlights', { ids }, 'feed.highlights');
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

  /** The reads of one activity's detail pane, each stored as it answers. */
  async function fetchActivityParts(id: string) {
    const mine = generation;
    const key = activityParts(id);
    const methods = snapshot.state.name === 'connected' ? (snapshot.state.methods ?? []) : [];
    keyed.set(askKey('activity.parts', { id }), key);
    let held: ActivityParts = {};
    const keep = (patch: ActivityParts) => {
      held = { ...held, ...patch };
      if (screens.put(key, mine, held)) publishScreens();
    };
    const asks: Promise<void>[] = [];
    if (methods.includes('activity.streams')) {
      asks.push(
        read('activity.streams', { id, types: DETAIL_STREAM_TYPES }, DETAIL_SLOTS.streams).then(
          (streams) => keep({ streams })
        )
      );
    }
    if (methods.includes('activity.intervals')) {
      asks.push(
        read('activity.intervals', { id }, DETAIL_SLOTS.laps).then((laps) => keep({ laps }))
      );
    }
    if (methods.includes('activity.detail')) {
      asks.push(
        read('activity.detail', { id }, DETAIL_SLOTS.screen).then((data) => keep({ data }))
      );
    }
    const settled = await Promise.allSettled(asks);
    // A read a newer ride replaced may be asked for again when its screen returns.
    if (settled.some((outcome) => outcome.status === 'rejected')) asked.delete(key);
  }

  /** The insights page's reads: the settings first, since they choose the bundle's windows. */
  async function fetchInsights() {
    const mine = generation;
    const methods = snapshot.state.name === 'connected' ? (snapshot.state.methods ?? []) : [];
    keyed.set(askKey('insights.parts', {}), INSIGHTS_PARTS_KEY);
    if (!methods.includes('insights.data')) return;
    let held: InsightsParts = {};
    const keep = (patch: InsightsParts) => {
      held = { ...held, ...patch };
      if (screens.put(INSIGHTS_PARTS_KEY, mine, held)) publishScreens();
    };
    try {
      const settings = methods.includes('settings.get')
        ? await read('settings.get', { keys: INSIGHT_SETTING_KEYS })
        : undefined;
      if (settings) keep({ settings });
      const data = await read(
        'insights.data',
        insightsAsk(insightsSettings(settings, '')),
        'insights.data'
      );
      keep({ data });
    } catch {
      // A read a newer ask replaced, or a connection that dropped, may be asked for again.
      asked.delete(INSIGHTS_PARTS_KEY);
    }
  }

  /** Each read the settings screen shows, stored as it answers. */
  async function fetchSettings() {
    const mine = generation;
    const { state } = snapshot;
    const methods = state.name === 'connected' ? (state.methods ?? []) : [];
    try {
      await Promise.all(
        settingsOpening(methods).map(async (opening) => {
          const method = opening.method as keyof SettingsReads;
          const answer = await read(method, opening.params as never);
          if (answer === undefined) return;
          const held = (screens.get('settings', mine) as SettingsReads | undefined) ?? {};
          if (screens.put('settings', mine, { ...held, [method]: answer })) publishScreens();
        })
      );
    } catch {
      if (mine === generation) dispatch({ type: 'drop' });
    }
  }

  /** Send the ask a screen needs, now that the machine has found the phone lists it. */
  async function answerScreen(method: string, params: object) {
    const mine = generation;
    try {
      if (method === 'activity.summary') {
        const { id } = params as { id: string };
        const summary = { id, ...(await read('activity.summary', { id }, 'detail')) };
        if (screens.put(`activity:${id}`, mine, summary)) publishScreens();
        return;
      }
      const key = keyed.get(askKey(method, params));
      if (key === undefined || !client) return;
      const answer = await read(method as keyof Methods, params as never);
      if (screens.put(key, mine, answer)) publishScreens();
    } catch (error) {
      // The list stays usable; a screen that failed is simply not shown. A
      // summary a newer detail replaced may be asked for again when its
      // screen returns.
      if (isSuperseded(error) && method === 'activity.summary') {
        asked.delete((params as { id: string }).id);
      }
    }
  }

  function request<M extends keyof Methods>(key: string, method: M, params: Methods[M]['params']) {
    const { state } = snapshot;
    if (state.name !== 'connected' || state.methods === null) return;
    if (asked.has(key)) return;
    asked.add(key);
    keyed.set(askKey(method, params), key);
    dispatch({ type: 'screen', method, params });
  }

  /**
   * Ask the phone for one fitness panel. A newer ask of the same slot
   * supersedes this one, so its late answer is dropped; the other slots are
   * not touched.
   */
  async function askPanel(panel: PanelAsk) {
    const { state } = snapshot;
    if (state.name !== 'connected' || !state.methods?.includes(panel.method)) return;
    const mine = generation;
    const ticket = slots.begin(panel.slot);
    try {
      const answer = await read(panel.method, panel.params as never, `fitness:${panel.slot}`);
      if (!slots.isCurrent(panel.slot, ticket) || mine !== generation) return;
      change({ fitness: { ...snapshot.fitness, [panel.slot]: { answer } } });
    } catch {
      if (slots.isCurrent(panel.slot, ticket) && mine === generation) {
        change({ fitness: { ...snapshot.fitness, [panel.slot]: 'failed' } });
      }
    }
  }

  /**
   * The phone's library changed: forget every list and detail held, read the
   * feed again and let each screen on view ask its reads again.
   */
  function refresh() {
    if (snapshot.state.name !== 'connected') return;
    cache.changed();
    asked.clear();
    change({ libraryChanges: snapshot.libraryChanges + 1 });
    void fetchFeed();
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
    cache.clear();
    asked.clear();
    keyed.clear();
    feedLoading = false;
    change({
      code: null,
      feed: null,
      feedMore: false,
      summary: null,
      sparklines: null,
      highlights: {},
      previews: {},
      details: {},
      libraryChanges: 0,
      fitness: {},
      screens: {},
      settings: {},
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
    async connectionFacts() {
      if (!peer || snapshot.state.name !== 'connected') return null;
      try {
        const report = await peer.getStats();
        return factsOf([...report.values()] as StatRow[]);
      } catch {
        return null;
      }
    },
    requestDetail(id) {
      const { state } = snapshot;
      if (state.name !== 'connected' || state.methods === null) return;
      if (asked.has(id)) return;
      asked.add(id);
      dispatch({ type: 'screen', method: 'activity.summary', params: { id } });
    },
    requestActivityParts(id) {
      const { state } = snapshot;
      if (state.name !== 'connected' || state.methods === null) return;
      const key = activityParts(id);
      if (asked.has(key)) return;
      asked.add(key);
      void fetchActivityParts(id);
    },
    requestInsights() {
      const { state } = snapshot;
      if (state.name !== 'connected' || state.methods === null) return;
      if (asked.has(INSIGHTS_PARTS_KEY)) return;
      asked.add(INSIGHTS_PARTS_KEY);
      void fetchInsights();
    },
    requestSettings() {
      const { state } = snapshot;
      if (state.name !== 'connected' || state.methods === null) return;
      if (asked.has('settings')) return;
      asked.add('settings');
      void fetchSettings();
    },
    request,
    requestStrength(periodDays) {
      request(`strength:${periodDays}`, 'strength.screen', {
        nowWallSeconds: wallSeconds(env.now(), env.timezoneOffset()),
        periodDays,
      });
    },
    requestFitness() {
      const { state } = snapshot;
      if (state.name !== 'connected' || state.methods === null) return;
      if (asked.has('fitness')) return;
      asked.add('fitness');
      const now = new Date(env.now());
      for (const panel of rangeAsks(snapshot.fitnessRange, now, snapshot.fitnessSport)) {
        void askPanel(panel);
      }
      void askPanel(screenAsk(now));
      void askPanel(bestEffortsAsk(snapshot.bestEffortDays));
    },
    setFitnessRange(days) {
      if (days === snapshot.fitnessRange) return;
      change({ fitnessRange: days });
      for (const panel of rangeAsks(days, new Date(env.now()), snapshot.fitnessSport)) {
        void askPanel(panel);
      }
    },
    setFitnessSport(sport) {
      if (sport === snapshot.fitnessSport) return;
      change({ fitnessSport: sport });
      for (const panel of rangeAsks(snapshot.fitnessRange, new Date(env.now()), sport)) {
        if (panel.slot === 'zones' || panel.slot === 'paceCurve') void askPanel(panel);
      }
    },
    setBestEffortDays(days) {
      if (days === snapshot.bestEffortDays) return;
      change({ bestEffortDays: days });
      void askPanel(bestEffortsAsk(days));
    },
    setFilter(filter) {
      feedGeneration++;
      change({ filter });
      if (snapshot.state.name !== 'connected') return;
      const mine = generation;
      screens.put('feed', mine, []);
      screens.put('feedMore', mine, false);
      screens.put('previews', mine, {});
      publishScreens();
      void loadFeedPage(0).catch((error) => {
        if (mine === generation && !isSuperseded(error)) dispatch({ type: 'drop' });
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
    async read(method, params) {
      if (!client) throw new Error('not connected');
      return client.ask(method as keyof Methods, params as never);
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
