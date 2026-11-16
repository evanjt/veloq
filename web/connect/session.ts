// The connect page's browser side without a screen: the relay socket, the
// WebRTC connection, the kept certificate and the effects `step` asks for.
// Every browser API it reaches is in the environment it is given, so a test
// stands in for each. What is drawn reads `get` and listens through
// `subscribe`.

import type { ParseKeys } from 'i18next';

import { PAIRING, factsOf, NOT_CONNECTED, type Facts, type StatRow } from './connection';
import { createClient, type Client } from './client';
import { browserKeys, type Keys } from './keys';
import {
  INVITATION_TTL_SECS,
  PAGE_MIN_PROTOCOL,
  PAGE_NAME,
  PAGE_PROTOCOL,
  answerFingerprint,
  base64url,
  invitation as invitationText,
  normaliseFingerprint,
  olderPage,
  peerConfiguration,
  proof,
  proofsMatch,
  roomFor,
  step,
  withoutHiddenCandidates,
  writeNotice,
  type Build,
  type Effect,
  type Event,
  type State,
} from './link';
import { QueryClient } from './query';
import type { Methods } from './schema';
import { hashBlob, sendArchive } from './upload';

const RELAY = 'wss://auth.veloq.fit/link/';
const STATUS_POLL_MS = 1000;
const GATHER_LIMIT_MS = 3000;
/** How long the page waits for the phone before it says the app has to be open, not in the background. */
export const STILL_WAITING_MS = 30_000;
/** A phone that refuses a browser stays silent, so an unanswered offer counts as a drop. */
const ANSWER_LIMIT_MS = 15000;
/** About a year. A browser whose certificate runs out links again. */
const CERTIFICATE_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

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
/**
 * An archive on its way to the phone: hashed, sent, handed to the phone's
 * import job, and the job's own counts once it runs.
 */
export type Upload = {
  name: string;
  size: number;
  /** Bytes read while hashing, then bytes the phone holds while sending. */
  done: number;
  phase: 'hashing' | 'sending' | 'waiting' | 'importing' | 'finished' | 'failed';
  /** What the phone's import job reports, once it has the archive. */
  job: Methods['import.status']['result'] | null;
  error: string | null;
};

export type Snapshot = {
  state: State;
  /** The text of the link code on screen, or null before one is made. */
  code: string | null;
  /** The archive being sent to the phone, or the last one sent; null before any. */
  upload: Upload | null;
  /** Why the phone refused the last write, such as being locked; null once a write goes through. */
  writeNotice: ParseKeys | null;
  /**
   * How many times on this connection the phone said its library changed. The
   * reads held are read again by the query layer; this is for what is not a
   * read, such as the map naming its track by a new url.
   */
  libraryChanges: number;
  /** The browser could not start: no certificate, or no WebRTC. */
  failed: boolean;
  /** When the connection opened, on the browser's clock; null unless connected. */
  connectedSince: number | null;
  /**
   * Whether the page on view stays up while the link tries again. Set once the
   * link has connected, kept through a drop and a retry, and cleared when the
   * athlete is pairing again.
   */
  held: boolean;
};

export interface Session {
  subscribe: (listener: () => void) => () => void;
  get: () => Snapshot;
  dispatch: (event: Event) => void;
  /** Read the kept certificate and phone, then start the machine. */
  start: () => Promise<void>;
  /** Forget the paired phone and pair afresh. */
  unlink: () => void;
  /** Try the phone now rather than when the wait ends, from waiting, connecting or an update. */
  retry: () => void;
  /**
   * Every read and write of the phone goes through this one client: reads are
   * held by method and arguments and read again when the library changes.
   */
  queries: QueryClient;
  /** The path, round trip and traffic of the open connection, from the browser's own stats. */
  connectionFacts: () => Promise<Facts | null>;
  /**
   * Send an archive to the phone and have it imported. The page keeps `file`
   * until the import is handed over, so a dropped link is reconnected and the
   * send goes on from the byte count the phone answers.
   */
  importArchive: (file: File) => Promise<void>;
}

export function createSession(env: Environment): Session {
  let snapshot: Snapshot = {
    state: { name: 'unpaired' },
    code: null,
    upload: null,
    writeNotice: null,
    libraryChanges: 0,
    failed: false,
    connectedSince: null,
    held: false,
  };
  const listeners = new Set<() => void>();
  /** Bumped on every hang-up, so a callback from an old connection does nothing. */
  let generation = 0;
  /** The one path to the phone: what a view reads, and every write, goes through it. */
  const queries = new QueryClient({
    methods: () => (snapshot.state.name === 'connected' ? snapshot.state.methods : null),
    ask: (method, params, { signal, slot }) =>
      client
        ? client.ask(method as keyof Methods, params as never, slot, signal)
        : Promise.reject(new Error(NOT_CONNECTED)),
  });
  let socket: WebSocket | null = null;
  let peer: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let client: Client | null = null;
  let timers: unknown[] = [];
  let waitTimer: unknown = null;
  let certificate: RTCCertificate;
  let browserFingerprint = '';
  let secret: Uint8Array<ArrayBuffer> | null = null;

  const change = (next: Partial<Snapshot>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of [...listeners]) listener();
  };

  queries.onWrite((event) => {
    if (event.error === null) {
      if (snapshot.writeNotice !== null) change({ writeNotice: null });
      return;
    }
    const text = writeNotice(event.error);
    if (text !== undefined) change({ writeNotice: text });
  });

  /**
   * One timer for the whole wait: armed when the page enters waiting and
   * cleared when it leaves, so a retry in between does not restart the count.
   */
  function watchWait(name: State['name']) {
    if (name === 'waiting') {
      if (waitTimer !== null) return;
      waitTimer = env.setTimeout(() => {
        waitTimer = null;
        dispatch({ type: 'stillWaiting' });
      }, STILL_WAITING_MS);
    } else if (waitTimer !== null) {
      env.clearTimeout(waitTimer);
      waitTimer = null;
    }
  }

  function dispatch(event: Event) {
    if (event.type === 'start') watchWait('unpaired');
    const result = step(snapshot.state, event);
    const { connectedSince, held } = snapshot;
    const since =
      result.state.name !== 'connected'
        ? null
        : snapshot.state.name === 'connected'
          ? connectedSince
          : env.now();
    // An update keeps the hold: a retry from it goes straight back to waiting, without connecting.
    const nextHeld = result.state.name === 'connected' || (held && !PAIRING.has(result.state.name));
    change({ state: result.state, connectedSince: since, held: nextHeld });
    watchWait(snapshot.state.name);
    // Reads asked while the phone's methods were unknown go out now.
    if (result.state.name === 'connected') queries.connected();
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
      case 'hangUp':
        hangUp();
        break;
      case 'signOut':
        signOut();
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

  /** The phone's library changed: every read held is read again, a watched one in place. */
  function refresh() {
    if (snapshot.state.name !== 'connected') return;
    queries.changed();
    change({ libraryChanges: snapshot.libraryChanges + 1 });
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
    queries.disconnected();
  }

  /** Forget every fetched row, release the page's hold and clear the pairing line. */
  function signOut() {
    queries.reset();
    change({ code: null, libraryChanges: 0, held: false });
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
    retry: () => dispatch({ type: 'retry' }),
    async connectionFacts() {
      if (!peer || snapshot.state.name !== 'connected') return null;
      try {
        const report = await peer.getStats();
        return factsOf([...report.values()] as StatRow[]);
      } catch {
        return null;
      }
    },
    queries,
    async importArchive(file) {
      const show = (next: Partial<Upload>) =>
        change({
          upload: {
            name: file.name,
            size: file.size,
            done: 0,
            phase: 'hashing',
            job: null,
            error: null,
            ...snapshot.upload,
            ...next,
          },
        });
      change({ upload: null });
      show({ phase: 'hashing' });
      const sha256 = await hashBlob(file, (done) => show({ done }));
      const connected = () =>
        new Promise<void>((resolve) => {
          if (snapshot.state.name === 'connected') {
            resolve();
            return;
          }
          const stop = this.subscribe(() => {
            if (snapshot.state.name !== 'connected') return;
            stop();
            resolve();
          });
        });
      for (;;) {
        await connected();
        const mine = generation;
        const sending = channel;
        const asking = client;
        if (!sending || !asking) {
          await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
          continue;
        }
        const stop = new AbortController();
        const watch = this.subscribe(() => {
          if (mine !== generation || snapshot.state.name !== 'connected') stop.abort();
        });
        try {
          show({ phase: 'sending' });
          const importId = await sendArchive({
            file,
            sha256,
            ask: (method, params) => asking.ask(method as keyof Methods, params as never),
            channel: {
              get bufferedAmount() {
                return sending.bufferedAmount;
              },
              get bufferedAmountLowThreshold() {
                return sending.bufferedAmountLowThreshold;
              },
              set bufferedAmountLowThreshold(value: number) {
                sending.bufferedAmountLowThreshold = value;
              },
              send: (data) => sending.send(data),
              onBufferedAmountLow: (listener) =>
                sending.addEventListener('bufferedamountlow', listener, { once: true }),
            },
            onProgress: (done) => show({ done }),
            signal: stop.signal,
          });
          await asking.ask('import.commit', { importId });
          show({ phase: 'importing' });
          for (;;) {
            const job = (await asking.ask(
              'import.status',
              {} as never
            )) as Methods['import.status']['result'];
            show({ job });
            if (job.state !== 'running') break;
            await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
          }
          show({ phase: 'finished' });
          return;
        } catch (error) {
          if (snapshot.state.name === 'connected' && mine === generation && !stop.signal.aborted) {
            const text = writeNotice(error);
            if (text !== undefined) change({ writeNotice: text });
            show({
              phase: 'failed',
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
          show({ phase: 'waiting' });
        } finally {
          watch();
        }
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
