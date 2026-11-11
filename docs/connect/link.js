// The connect page's rules, with no browser API but WebCrypto, so they are
// tested on their own. The engine holds the other half of every derivation
// here, and the two must agree byte for byte.

/** The longest an invitation lasts. The phone refuses one past two minutes. */
export const INVITATION_TTL_SECS = 110;

/**
 * The server the page asks for its public address. A STUN server learns only
 * that address, never the data, which stays end to end between the browser
 * and the phone. The phone names the same server.
 */
export const STUN_SERVER = 'stun:stun.cloudflare.com:3478';

/**
 * The peer connection's configuration: the pinned certificate and the STUN
 * server.
 * @param {RTCCertificate} certificate
 */
export function peerConfiguration(certificate) {
  return { certificates: [certificate], iceServers: [{ urls: STUN_SERVER }] };
}

const FIRST_RETRY_MS = 2_000;
const LAST_RETRY_MS = 30_000;

const encoder = new TextEncoder();

/** @param {Uint8Array} bytes */
export function base64url(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} text */
function base64urlBytes(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/** The spelling pins are kept in: the hash in lower case, the hex in upper. */
export function normaliseFingerprint(/** @type {string} */ algorithm, /** @type {string} */ value) {
  return `${algorithm.trim().toLowerCase()} ${value.trim().toUpperCase()}`;
}

/**
 * The certificate fingerprint an answer names. The browser's DTLS refuses a
 * connection whose certificate does not match it, so it is the phone's own.
 * @param {string} sdp
 * @returns {string | null}
 */
export function answerFingerprint(sdp) {
  const line = /^a=fingerprint:(\S+) (\S+)\s*$/m.exec(sdp);
  return line ? normaliseFingerprint(line[1], line[2]) : null;
}

/**
 * The offer without host candidates hidden behind a generated `.local` name,
 * which the phone does not resolve. It learns the browser's address from the
 * connectivity checks instead.
 * @param {string} sdp
 */
export function withoutHiddenCandidates(sdp) {
  return sdp
    .split('\r\n')
    .filter((line) => !/^a=candidate:\S+ \d+ \S+ \d+ \S+\.local /i.test(line))
    .join('\r\n');
}

/** @param {...string} parts */
function lengthPrefixed(...parts) {
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

/**
 * The room a paired browser and phone meet in: a hash of both fingerprints.
 * @param {string} browser
 * @param {string} phone
 */
export async function roomFor(browser, phone) {
  const prefix = encoder.encode('veloq link room');
  const body = lengthPrefixed(browser, phone);
  const bytes = new Uint8Array(prefix.length + body.length);
  bytes.set(prefix);
  bytes.set(body, prefix.length);
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

/**
 * One side's proof that it holds the secret, over its role and both
 * fingerprints.
 * @param {Uint8Array} secret
 * @param {'browser' | 'phone'} role
 * @param {string} browser
 * @param {string} phone
 */
export async function proof(secret, role, browser, phone) {
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

/** @param {string} given @param {string} expected */
export function proofsMatch(given, expected) {
  const a = base64urlBytes(given);
  const b = base64urlBytes(expected);
  let differ = a.length ^ b.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) differ |= a[i] ^ b[i];
  return differ === 0;
}

/**
 * The text the QR code carries.
 * @param {{ room: string, secret: Uint8Array, fp: string, now: number }} args
 */
export function invitation({ room, secret, fp, now }) {
  return JSON.stringify({ v: 1, room, secret: base64url(secret), fp, exp: now + INVITATION_TTL_SECS });
}

/** How long to wait before the next try after `attempt` failed ones. */
export function retryDelay(/** @type {number} */ attempt) {
  return Math.min(FIRST_RETRY_MS * 2 ** Math.min(attempt, 10), LAST_RETRY_MS);
}

/**
 * @typedef {{ room: string, secret: Uint8Array, exp: number }} Invitation
 * @typedef {{ name: 'unpaired', notice?: 'refused' | 'declined' }
 *   | { name: 'inviting', invitation: Invitation, attempt: number }
 *   | { name: 'proving', invitation: Invitation, phone: string }
 *   | { name: 'confirming', invitation: Invitation, phone: string }
 *   | { name: 'waiting', phone: string, attempt: number }
 *   | { name: 'connecting', phone: string, attempt: number }
 *   | { name: 'connected', phone: string, attempt: number, feed: unknown[] | null, detail: unknown | null }
 * } State
 * @typedef {{ type: 'start', phone: string | null }
 *   | { type: 'invited', invitation: Invitation }
 *   | { type: 'peer' }
 *   | { type: 'answered', fingerprint: string | null }
 *   | { type: 'open' }
 *   | { type: 'proved', ok: boolean }
 *   | { type: 'status', value: string }
 *   | { type: 'feed', rows: unknown[] }
 *   | { type: 'detail', summary: unknown }
 *   | { type: 'drop' }
 *   | { type: 'relayClosed' }
 *   | { type: 'expired' }
 *   | { type: 'forget' }
 * } Event
 * @typedef {{ do: 'invite' }
 *   | { do: 'joinLinked', phone: string }
 *   | { do: 'offer' }
 *   | { do: 'prove' }
 *   | { do: 'pollStatus' }
 *   | { do: 'remember', phone: string }
 *   | { do: 'forget' }
 *   | { do: 'fetchFeed' }
 *   | { do: 'hangUp' }
 *   | { do: 'retry', delay: number }
 *   | { do: 'rejoin', room: string, delay: number }
 * } Effect
 */

/** @param {State} state @param {Effect[]} [effects] */
const to = (state, effects = []) => ({ state, effects });

/**
 * Start pairing again, after a refusal or with nothing paired.
 * @param {'refused' | 'declined'} [notice]
 */
const afresh = (notice) =>
  to(notice ? { name: 'unpaired', notice } : { name: 'unpaired' }, [
    { do: 'hangUp' },
    { do: 'invite' },
  ]);

/**
 * One step of the page: the next state and what to do about it. Fetched data
 * is held only in the connected state, so leaving it forgets every row.
 * @param {State} state
 * @param {Event} event
 * @returns {{ state: State, effects: Effect[] }}
 */
export function step(state, event) {
  if (event.type === 'start') {
    if (event.phone === null) return to({ name: 'unpaired' }, [{ do: 'invite' }]);
    return to({ name: 'waiting', phone: event.phone, attempt: 0 }, [
      { do: 'joinLinked', phone: event.phone },
    ]);
  }
  if (event.type === 'forget') {
    return to({ name: 'unpaired' }, [{ do: 'hangUp' }, { do: 'forget' }, { do: 'invite' }]);
  }

  switch (state.name) {
    case 'unpaired':
      if (event.type === 'invited') {
        return to({ name: 'inviting', invitation: event.invitation, attempt: 0 });
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
          return to({ name: 'connected', phone: state.phone, attempt: 0, feed: null, detail: null }, [
            { do: 'remember', phone: state.phone },
            { do: 'fetchFeed' },
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
        return to({ name: 'connected', phone: state.phone, attempt: 0, feed: null, detail: null }, [
          { do: 'fetchFeed' },
        ]);
      }
      if (event.type === 'drop') return dropped(state.phone, state.attempt);
      return to(state);

    case 'connected':
      if (event.type === 'feed') return to({ ...state, feed: event.rows });
      if (event.type === 'detail') return to({ ...state, detail: event.summary });
      if (event.type === 'drop') return dropped(state.phone, state.attempt);
      return to(state);

    default:
      return to(state);
  }
}

/** @param {string} phone @param {number} attempt */
function dropped(phone, attempt) {
  return to({ name: 'waiting', phone, attempt: attempt + 1 }, [
    { do: 'hangUp' },
    { do: 'retry', delay: retryDelay(attempt) },
  ]);
}
