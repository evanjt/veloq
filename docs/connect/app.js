// The connect page's browser side: the relay socket, the WebRTC connection,
// the kept certificate and what is drawn. Every decision is `step` in link.js.

import { toQR } from './qr.js';
import {
  INVITATION_TTL_SECS,
  answerFingerprint,
  base64url,
  invitation as invitationText,
  normaliseFingerprint,
  peerConfiguration,
  proof,
  proofsMatch,
  roomFor,
  step,
  withoutHiddenCandidates,
} from './link.js';

const RELAY = 'wss://auth.veloq.fit/link/';
const FEED_PAGE = 50;
const STATUS_POLL_MS = 1000;
const GATHER_LIMIT_MS = 3000;
/** A phone that refuses a browser stays silent, so an unanswered offer counts as a drop. */
const ANSWER_LIMIT_MS = 15000;
/** About a year. A browser whose certificate runs out links again. */
const CERTIFICATE_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

/** @type {import('./link.js').State} */
let state = { name: 'unpaired' };
/** Bumped on every hang-up, so a callback from an old connection does nothing. */
let session = 0;
/** @type {WebSocket | null} */
let socket = null;
/** @type {RTCPeerConnection | null} */
let peer = null;
/** @type {RTCDataChannel | null} */
let channel = null;
/** @type {Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>} */
const pending = new Map();
let nextId = 1;
/** @type {ReturnType<typeof setTimeout>[]} */
let timers = [];
/** @type {RTCCertificate} */
let certificate;
let browserFingerprint = '';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

// ---- kept between visits: this browser's certificate and the paired phone

/** @returns {Promise<IDBDatabase>} */
function openStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('veloq-connect', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** @param {'readonly' | 'readwrite'} mode @param {(keys: IDBObjectStore) => IDBRequest} use */
async function withKeys(mode, use) {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const request = use(db.transaction('keys', mode).objectStore('keys'));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const readKey = (/** @type {string} */ key) => withKeys('readonly', (keys) => keys.get(key));
const writeKey = (/** @type {string} */ key, /** @type {unknown} */ value) =>
  withKeys('readwrite', (keys) => keys.put(value, key));
const dropKey = (/** @type {string} */ key) => withKeys('readwrite', (keys) => keys.delete(key));

/** @returns {Promise<RTCCertificate>} */
async function keptCertificate() {
  /** @type {RTCCertificate | undefined} */
  const kept = await readKey('certificate');
  if (kept && kept.expires > Date.now()) return kept;
  const made = await RTCPeerConnection.generateCertificate(
    /** @type {any} */ ({ name: 'ECDSA', namedCurve: 'P-256', expires: CERTIFICATE_LIFETIME_MS })
  );
  await writeKey('certificate', made);
  await dropKey('phone');
  return made;
}

/** The certificate's fingerprint, read from an offer where the browser cannot list it. */
async function fingerprintOf(/** @type {RTCCertificate} */ cert) {
  const listed = cert.getFingerprints?.().find((entry) => entry.algorithm === 'sha-256');
  if (listed) return normaliseFingerprint(listed.algorithm, listed.value);
  const probe = new RTCPeerConnection({ certificates: [cert] });
  probe.createDataChannel('probe');
  const offer = await probe.createOffer();
  probe.close();
  const found = answerFingerprint(offer.sdp ?? '');
  if (!found) throw new Error('no certificate fingerprint');
  return found;
}

// ---- the machine

/** @param {import('./link.js').Event} event */
function dispatch(event) {
  const result = step(state, event);
  state = result.state;
  render();
  for (const effect of result.effects) void run(effect);
}

/** @param {import('./link.js').Effect} effect */
async function run(effect) {
  switch (effect.do) {
    case 'invite':
      invite();
      break;
    case 'joinLinked':
      await join(await roomFor(browserFingerprint, effect.phone));
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
          dispatch({ type: 'status', value: String(await ask('pair.status')) });
        } catch {
          dispatch({ type: 'drop' });
        }
      });
      break;
    case 'remember':
      await writeKey('phone', effect.phone);
      break;
    case 'forget':
      await dropKey('phone');
      break;
    case 'fetchFeed':
      await fetchFeed();
      break;
    case 'hangUp':
      hangUp();
      break;
    case 'rejoin':
      later(effect.delay, async () => {
        if (state.name === 'inviting') await join(effect.room);
      });
      break;
    case 'retry':
      later(effect.delay, async () => {
        if (state.name === 'waiting') await join(await roomFor(browserFingerprint, state.phone));
      });
      break;
  }
}

/** Run `work` after `ms`, unless the connection is hung up first. */
function later(/** @type {number} */ ms, /** @type {() => unknown} */ work) {
  const mine = session;
  timers.push(
    setTimeout(() => {
      if (mine === session) void work();
    }, ms)
  );
}

/** @type {Uint8Array | null} */
let secret = null;

function invite() {
  const room = base64url(crypto.getRandomValues(new Uint8Array(16)));
  secret = crypto.getRandomValues(new Uint8Array(32));
  const now = Math.floor(Date.now() / 1000);
  drawCode(invitationText({ room, secret, fp: browserFingerprint, now }));
  dispatch({
    type: 'invited',
    invitation: { room, secret, exp: now + INVITATION_TTL_SECS },
  });
  void join(room);
  later(INVITATION_TTL_SECS * 1000, () => dispatch({ type: 'expired' }));
}

/** Wait in a relay room for the phone. */
async function join(/** @type {string} */ room) {
  socket?.close();
  const mine = session;
  const opened = new WebSocket(RELAY + room);
  socket = opened;
  opened.onmessage = async ({ data }) => {
    if (mine !== session || typeof data !== 'string') return;
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (message.type === 'peer') dispatch({ type: 'peer' });
    else if (message.type === 'answer' && peer) {
      await peer.setRemoteDescription(message);
      if (mine === session) dispatch({ type: 'answered', fingerprint: answerFingerprint(message.sdp) });
    } else if (message.type === 'bye') {
      dispatch({ type: 'bye' });
    }
  };
  opened.onclose = () => {
    if (mine !== session || socket !== opened) return;
    socket = null;
    dispatch({ type: 'relayClosed' });
  };
}

async function offer() {
  peer?.close();
  const mine = session;
  const made = new RTCPeerConnection(peerConfiguration(certificate));
  peer = made;
  const opened = made.createDataChannel('veloq');
  channel = opened;
  opened.onopen = () => mine === session && dispatch({ type: 'open' });
  opened.onclose = () => mine === session && dispatch({ type: 'drop' });
  opened.onmessage = ({ data }) => settle(data);
  made.onconnectionstatechange = () => {
    if (mine === session && made.connectionState === 'failed') dispatch({ type: 'drop' });
  };

  await made.setLocalDescription(await made.createOffer());
  await gathered(made);
  if (mine !== session || !made.localDescription) return;
  socket?.send(
    JSON.stringify({ type: 'offer', sdp: withoutHiddenCandidates(made.localDescription.sdp) })
  );
  later(ANSWER_LIMIT_MS, () => {
    if (peer === made && !made.remoteDescription) dispatch({ type: 'drop' });
  });
}

/** The phone takes no trickled candidates, so the offer waits for all of them. */
function gathered(/** @type {RTCPeerConnection} */ connection) {
  return new Promise((resolve) => {
    const done = () => resolve(undefined);
    if (connection.iceGatheringState === 'complete') {
      done();
    } else {
      connection.addEventListener('icegatheringstatechange', () => {
        if (connection.iceGatheringState === 'complete') done();
      });
      setTimeout(done, GATHER_LIMIT_MS);
    }
  });
}

/** Ask the phone one thing over the data channel. */
function ask(/** @type {string} */ method, /** @type {object} */ params = {}) {
  return new Promise((resolve, reject) => {
    if (!channel || channel.readyState !== 'open') {
      reject(new Error('not connected'));
    } else {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      channel.send(JSON.stringify({ id, method, params }));
    }
  });
}

function settle(/** @type {unknown} */ data) {
  if (typeof data !== 'string') return;
  let reply;
  try {
    reply = JSON.parse(data);
  } catch {
    return;
  }
  const waiting = pending.get(reply.id);
  if (!waiting) return;
  pending.delete(reply.id);
  if ('error' in reply) waiting.reject(new Error(String(reply.error)));
  else waiting.resolve(reply.result);
}

async function prove() {
  if (state.name !== 'proving' || !secret) return;
  const phone = state.phone;
  const mine = proof(secret, 'browser', browserFingerprint, phone);
  const expected = proof(secret, 'phone', browserFingerprint, phone);
  try {
    const reply = /** @type {{ phoneProof?: string }} */ (
      await ask('pair.prove', { proof: await mine, name: browserName() })
    );
    const ok = typeof reply.phoneProof === 'string' && proofsMatch(reply.phoneProof, await expected);
    dispatch({ type: 'proved', ok });
  } catch {
    dispatch({ type: 'proved', ok: false });
  }
}

/** What the phone lists this browser as. */
function browserName() {
  const agent = navigator.userAgent;
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

async function fetchFeed() {
  try {
    const page = /** @type {{ cards: unknown[] }} */ (
      await ask('feed.page', { offset: 0, limit: FEED_PAGE })
    );
    dispatch({ type: 'feed', rows: page.cards });
  } catch {
    dispatch({ type: 'drop' });
  }
}

/** @type {string | null} */
let shownId = null;

async function showDetail(/** @type {string} */ id) {
  shownId = id;
  render();
  try {
    dispatch({ type: 'detail', summary: { id, ...(await ask('activity.summary', { id })) } });
  } catch {
    // The list stays usable; a summary that failed is simply not shown.
  }
}

function hangUp() {
  session++;
  for (const timer of timers) clearTimeout(timer);
  timers = [];
  for (const { reject } of pending.values()) reject(new Error('hung up'));
  pending.clear();
  channel?.close();
  peer?.close();
  socket?.close();
  channel = null;
  peer = null;
  socket = null;
  shownId = null;
}

// ---- drawing

function drawCode(/** @type {string} */ text) {
  const modules = toQR(text);
  const size = Math.sqrt(modules.length);
  const canvas = /** @type {HTMLCanvasElement} */ ($('code'));
  const quiet = 4;
  const scale = Math.floor(canvas.width / (size + quiet * 2));
  const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000';
  const offset = Math.floor((canvas.width - size * scale) / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y * size + x]) context.fillRect(offset + x * scale, offset + y * scale, scale, scale);
    }
  }
}

const STATUS = {
  unpaired: 'Not linked',
  inviting: 'Waiting for the code to be scanned',
  proving: 'Checking the phone',
  confirming: 'Confirm on your phone',
  waiting: 'Waiting for your phone',
  connecting: 'Connecting',
  connected: 'Connected',
};

const NOTICE = {
  refused: 'The phone refused this browser. Link it again with a new code.',
  declined: 'Linking was declined on the phone.',
};

/** @param {number | null | undefined} metres */
const km = (metres) => (metres == null ? null : `${(metres / 1000).toFixed(1)} km`);
/** @param {number | null | undefined} seconds */
function clock(seconds) {
  if (seconds == null) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}
/** @param {number | null | undefined} speed */
const kmh = (speed) => (speed == null ? null : `${(speed * 3.6).toFixed(1)} km/h`);

function render() {
  $('status').textContent = STATUS[state.name];
  const pairing = ['unpaired', 'inviting', 'proving', 'confirming'].includes(state.name);
  $('pair').hidden = !pairing;
  $('waiting').hidden = !(state.name === 'waiting' || state.name === 'connecting');
  $('library').hidden = state.name !== 'connected';
  $('forget').hidden = pairing;

  const notice = $('pair-notice');
  notice.hidden = !(state.name === 'unpaired' && state.notice);
  notice.textContent = state.name === 'unpaired' && state.notice ? NOTICE[state.notice] : '';

  const feed = $('feed');
  const rows = state.name === 'connected' ? /** @type {any[]} */ (state.feed ?? []) : [];
  feed.replaceChildren(
    ...rows.map((card) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-current', String(card.id === shownId));
      button.textContent = card.name;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = [
        String(card.startDateLocal ?? '').slice(0, 10),
        card.sportType,
        km(card.distance),
        clock(card.movingTime),
      ]
        .filter(Boolean)
        .join(' · ');
      button.append(meta);
      button.addEventListener('click', () => void showDetail(card.id));
      item.append(button);
      return item;
    })
  );

  const detail = state.name === 'connected' ? /** @type {any} */ (state.detail) : null;
  const card = rows.find((row) => row.id === shownId);
  $('detail-title').textContent = card ? card.name : 'Pick an activity';
  const facts =
    card && detail && detail.id === shownId
      ? [
          ['Distance', km(card.distance)],
          ['Moving time', clock(detail.movingTime)],
          ['Elapsed time', clock(detail.elapsedTime)],
          ['Average speed', kmh(detail.averageSpeed)],
          ['Top speed', kmh(detail.maxSpeed)],
          ['Climbing', card.elevationGain == null ? null : `${Math.round(card.elevationGain)} m`],
          ['Average heart rate', card.avgHr == null ? null : `${Math.round(card.avgHr)} bpm`],
          ['Average power', card.avgPower == null ? null : `${Math.round(card.avgPower)} W`],
          ['Training load', card.trainingLoad == null ? null : String(Math.round(card.trainingLoad))],
        ]
      : [];
  $('detail').replaceChildren(
    ...facts
      .filter(([, value]) => value)
      .flatMap(([label, value]) => {
        const term = document.createElement('dt');
        term.textContent = label;
        const description = document.createElement('dd');
        description.textContent = value;
        return [term, description];
      })
  );
}

// ---- start

async function start() {
  try {
    certificate = await keptCertificate();
    browserFingerprint = await fingerprintOf(certificate);
    /** @type {string | undefined} */
    const phone = await readKey('phone');
    $('forget').addEventListener('click', () => dispatch({ type: 'forget' }));
    dispatch({ type: 'start', phone: phone ?? null });
  } catch {
    $('status').textContent = 'This browser cannot link to the phone. Try a current Chrome, Edge or Firefox.';
  }
}

void start();
