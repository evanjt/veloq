/**
 * The scripted phone and relay the connect page talks to when no handset is
 * paired. `instrument` returns JavaScript to run before the page's own scripts:
 * it replaces `WebSocket` with a relay that plays the script,
 * `RTCPeerConnection` with a connection whose channel answers from the script,
 * and the page's random bytes with fixed ones, so the proof the phone must give
 * is known beforehand. The browser harness and the dev server both use it.
 */

import { FRAMED_FROM, PAGE_PROTOCOL } from '../../../web/connect/link';
import type { FfiLinkHelloAnswer } from '../../../web/connect/schema';

/** The room the page makes for its first invitation, under the fixed random bytes below. */
export const INVITE_ROOM = 'AQEBAQEBAQEBAQEBAQEBAQ';

/** What the stand-in phone and relay do. */
export interface Script {
  /** The certificate fingerprint the browser's stand-in reports, in the SDP's spelling. */
  browserFingerprint: string;
  /** Whether a peer joins the room of an invitation, and with which fingerprint it answers. */
  invite: { fingerprint: string } | null;
  /** The same for the room shared with a phone that is already paired. */
  linked: { fingerprint: string } | null;
  /** What the phone answers `pair.prove` with. */
  phoneProof: string;
  /** The methods the phone lists in its hello. */
  methods: string[];
  /** What the phone answers each method with, by method name. */
  results: Record<string, unknown>;
  /** What the phone answers a method with for one entity, by method name and then the id of the activity, route group, section or exercise category asked for, ahead of `results`. */
  byActivity?: Record<string, Record<string, unknown>>;
  /** The PNG, as base64, the phone answers `heatmap.tile` with by `z/x/y`; a tile not listed holds no heat. */
  tiles?: Record<string, string>;
  /** What `heatmap.tile` answers for a tile `tiles` does not list, by the base the page asks for. */
  tilesByBase?: Record<string, string>;
  /** What `heatmap.tile` answers for a tile neither `tiles` nor `tilesByBase` lists; without it that tile holds no heat. */
  anyTile?: string;
  /** The rows the phone narrows by the ask, as the engine does, ahead of `results`. */
  windowed?: Windowed;
  /** The name the phone gives itself in its hello, if it gives one. */
  device?: string;
  /** How long the phone takes to answer each ask, in milliseconds; none when absent. */
  delayMs?: number;
  /** The protocol the phone's hello names; the page's newest when absent. */
  protocol?: number;
  /** The rows the browser's own `getStats()` report holds for the open connection. */
  stats: Record<string, unknown>[];
}

/** One activity the feed can list: its card, the preview of its track, and what a search and a chip read. */
export interface FeedEntry {
  /** Start time in epoch seconds, as the feed's window reads it. */
  ts: number;
  family: string;
  name: string;
  sport: string;
  card: unknown;
  preview: unknown;
}

/** The activities of the feed, newest first, and the order the family chips list in. */
export interface FeedLibrary {
  entries: FeedEntry[];
  families: string[];
}

/** A series of days a read answers the window of: its rows by `YYYY-MM-DD`, and the rest of the answer. */
export interface DaysLibrary {
  field: string;
  /** `day` when the ask names its bounds as days, `wall` when it names them in wall-clock seconds. */
  bounds: 'day' | 'wall';
  rows: { date: string }[];
  /** Fields of the answer that hold one entry per row, in the rows' order, cut to the window with them. */
  alongside?: Record<string, unknown[]>;
  rest: Record<string, unknown>;
}

export interface Windowed {
  feed?: FeedLibrary;
  days?: Record<string, DaysLibrary>;
  /** The routes screen's answer for an empty search; a search narrows its groups and sections by name. */
  routes?: Record<string, unknown>;
  /** The exercise picker's answer for an empty query; a query narrows its rows by display name. */
  picker?: Record<string, unknown>;
}

/**
 * The feed page the engine answers: the activities inside the window whose name or sport holds
 * the search text, newest first, narrowed by the family chips and then paged. The chips' counts
 * leave the family filter out, so each shows what turning it on would list.
 *
 * `instrument` embeds this function's source in the page, so it holds no nested function.
 */
export function feedPageFor(library: FeedLibrary, ask: Record<string, unknown>) {
  const needle = String(ask.needle || '')
    .trim()
    .toLowerCase();
  const chosen = (ask.sportFamilies as string[] | undefined) || [];
  const oldest = typeof ask.oldestTs === 'number' ? ask.oldestTs : -Infinity;
  const newest = typeof ask.newestTs === 'number' ? ask.newestTs : Infinity;
  const first = Number(ask.offset) || 0;
  const last = typeof ask.limit === 'number' ? first + ask.limit : Infinity;
  const counts: Record<string, number> = {};
  const cards: unknown[] = [];
  const previews: unknown[] = [];
  let matched = 0;
  for (let at = 0; at < library.entries.length; at++) {
    const entry = library.entries[at] as FeedEntry;
    if (entry.ts < oldest || entry.ts > newest) continue;
    if (
      needle !== '' &&
      entry.name.toLowerCase().indexOf(needle) < 0 &&
      entry.sport.toLowerCase().indexOf(needle) < 0
    ) {
      continue;
    }
    counts[entry.family] = (counts[entry.family] || 0) + 1;
    if (chosen.length > 0 && chosen.indexOf(entry.family) < 0) continue;
    if (matched >= first && matched < last) {
      cards.push(entry.card);
      if (entry.preview) previews.push(entry.preview);
    }
    matched++;
  }
  const familyCounts: { family: string; count: number }[] = [];
  for (let at = 0; at < library.families.length; at++) {
    const family = library.families[at] as string;
    if (counts[family]) familyCounts.push({ family, count: counts[family] as number });
  }
  return {
    cards,
    matchedCount: matched,
    hasMore: matched > last,
    previews,
    familyCounts,
  };
}

/**
 * The routes screen the engine answers: the groups whose name holds the group search and the
 * sections whose name holds the section search, each with the count the search left.
 *
 * `instrument` embeds this function's source in the page, so it holds no nested function.
 */
export function routesScreenFor(base: Record<string, unknown>, ask: Record<string, unknown>) {
  const groupNeedle = String(ask.groupSearch || '')
    .trim()
    .toLowerCase();
  const sectionNeedle = String(ask.sectionSearch || '')
    .trim()
    .toLowerCase();
  const groups: unknown[] = [];
  const baseGroups = base.groups as { customName: string | null }[];
  for (let at = 0; at < baseGroups.length; at++) {
    const name = String(baseGroups[at]?.customName || '').toLowerCase();
    if (groupNeedle === '' || name.indexOf(groupNeedle) >= 0) groups.push(baseGroups[at]);
  }
  const sections: unknown[] = [];
  const baseSections = base.sections as { name: string | null }[];
  for (let at = 0; at < baseSections.length; at++) {
    const name = String(baseSections[at]?.name || '').toLowerCase();
    if (sectionNeedle === '' || name.indexOf(sectionNeedle) >= 0) sections.push(baseSections[at]);
  }
  const answer: Record<string, unknown> = {};
  for (const key in base) answer[key] = base[key];
  answer.groups = groups;
  answer.sections = sections;
  answer.filteredGroupCount = groups.length;
  answer.filteredSectionCount = sections.length;
  return answer;
}

/**
 * The exercise picker the engine answers: the rows whose display name holds the query.
 *
 * `instrument` embeds this function's source in the page, so it holds no nested function.
 */
export function pickerFor(base: Record<string, unknown>, ask: Record<string, unknown>) {
  const needle = String(ask.query || '')
    .trim()
    .toLowerCase();
  const rows: unknown[] = [];
  const baseRows = base.rows as { displayName: string }[];
  for (let at = 0; at < baseRows.length; at++) {
    const name = String(baseRows[at]?.displayName || '').toLowerCase();
    if (needle === '' || name.indexOf(needle) >= 0) rows.push(baseRows[at]);
  }
  const answer: Record<string, unknown> = {};
  for (const key in base) answer[key] = base[key];
  answer.rows = rows;
  return answer;
}

/** The days of a series that fall inside the ask's bounds, both inclusive, and the rest of the answer. */
export function daysFor(library: DaysLibrary, ask: Record<string, unknown>) {
  const oldest =
    library.bounds === 'day'
      ? String(ask.oldest)
      : new Date(Number(ask.startTs) * 1000).toISOString().slice(0, 10);
  const newest =
    library.bounds === 'day'
      ? String(ask.newest)
      : new Date(Number(ask.endTs) * 1000).toISOString().slice(0, 10);
  const rows: unknown[] = [];
  const alongside: Record<string, unknown[]> = {};
  for (const key in library.alongside) alongside[key] = [];
  for (let at = 0; at < library.rows.length; at++) {
    const row = library.rows[at] as { date: string };
    if (row.date < oldest || row.date > newest) continue;
    rows.push(row);
    for (const key in library.alongside)
      (alongside[key] as unknown[]).push(library.alongside[key]?.[at]);
  }
  const answer: Record<string, unknown> = {};
  for (const key in library.rest) answer[key] = library.rest[key];
  for (const key in alongside) answer[key] = alongside[key];
  answer[library.field] = rows;
  return answer;
}

/** A saved workout as the phone keeps it: what the save sent, under the id it was answered with. */
interface KeptWorkout {
  id: string;
  name: string;
  exercises: { sets: unknown[] }[];
  groups: unknown[];
}

/**
 * Keeps what a workout write sent, so the phone reads the workout back. A save is answered with
 * the id the phone gives it, and that id then reads as the saved workout and is listed beside the
 * others; a rename changes the name the read and the list give for its workout. A method that is
 * not one of those writes is left alone. The demo phone answers every save with one id, so a
 * second save replaces the first.
 *
 * It changes the script it is given, which the page holds for its own visit, so `instrument` runs
 * it there too. It holds no nested function, since a bundler's name-keeping wrapper would reach
 * the page as an undefined reference, and a list row's clock is 0 because the list shows no date
 * and a demo phone keeps none.
 */
export function keepWrite(
  script: Pick<Script, 'results' | 'byActivity'>,
  method: string,
  params: Record<string, unknown> | undefined,
  answer: unknown
): void {
  if (!params) return;
  if (!script.byActivity) script.byActivity = {};
  const reads = script.byActivity;
  if (!reads['strength.workout']) reads['strength.workout'] = {};
  const byId = reads['strength.workout'] as Record<string, { workout: KeptWorkout }>;
  const listing = script.results['strength.workouts'] as
    { workouts: { id: string; name: string; [field: string]: unknown }[] } | undefined;
  if (method === 'strength.saveWorkout') {
    const id = answer && (answer as { id?: unknown }).id;
    if (typeof id !== 'string') return;
    const name = String(params.name);
    const exercises = params.exercises as KeptWorkout['exercises'];
    let sets = 0;
    for (let at = 0; at < exercises.length; at++) {
      sets += (exercises[at] as { sets: unknown[] }).sets.length;
    }
    byId[id] = { workout: { id, name, exercises, groups: params.groups as unknown[] } };
    if (listing) {
      const kept = listing.workouts.filter((row) => row.id !== id);
      kept.push({
        id,
        name,
        exerciseCount: exercises.length,
        setCount: sets,
        lastUsedAt: null,
        createdAt: 0,
      });
      listing.workouts = kept;
    }
  } else if (method === 'strength.renameWorkout') {
    const id = String(params.id);
    const name = String(params.name);
    const held = byId[id];
    if (!held) return;
    held.workout.name = name;
    if (listing) {
      for (let at = 0; at < listing.workouts.length; at++) {
        if (listing.workouts[at].id === id) listing.workouts[at].name = name;
      }
    }
  }
}

/**
 * What the phone's hello answers, derived from the protocol and the methods the
 * script gives it. It is the only place the hello is written, so the methods a
 * phone lists and the protocol it names cannot disagree.
 */
export function helloOf(
  script: Pick<Script, 'protocol' | 'methods' | 'device'>
): FfiLinkHelloAnswer {
  const protocol = script.protocol ?? PAGE_PROTOCOL;
  return {
    protocol,
    minProtocol: protocol,
    maxProtocol: protocol,
    app: 'test',
    methods: [...script.methods],
    device: script.device ?? null,
  };
}

/**
 * What the phone answers one ask with: `{ result }`, or `{ error }` for an ask the phone refuses.
 * A method with rows by entity answers an entity it holds from its row, and an entity it does not
 * hold with an error, as the engine answers an id it has no record of. A method with no rows, or an
 * ask that names no entity, takes the method's default.
 *
 * `instrument` embeds this function's source in the page, so it holds no nested function: a
 * bundler's name-keeping wrapper would reach the page as an undefined reference.
 */
export function answerAsk(
  script: Pick<Script, 'results' | 'byActivity' | 'windowed'>,
  method: string,
  params: Record<string, unknown> | undefined
): { result: unknown; error?: undefined } | { error: string; result?: undefined } {
  // The entity an ask names: an activity, a route group, a section or an exercise category.
  const keys = ['id', 'groupId', 'sectionId', 'exerciseCategory'];
  let key = '';
  for (let at = 0; params && at < keys.length; at++) {
    if (params[keys[at]] !== undefined) {
      key = String(params[keys[at]]);
      break;
    }
  }
  const rows = script.byActivity ? script.byActivity[method] : undefined;
  if (rows && key !== '') {
    if (Object.prototype.hasOwnProperty.call(rows, key)) return { result: rows[key] };
    return { error: 'no ' + method + ' for ' + key };
  }
  const windowed = script.windowed;
  if (windowed && windowed.feed && method === 'feed.page') {
    return { result: feedPageFor(windowed.feed, params || {}) };
  }
  if (windowed && windowed.routes && method === 'routes.screen') {
    return { result: routesScreenFor(windowed.routes, params || {}) };
  }
  if (windowed && windowed.picker && method === 'strength.picker') {
    return { result: pickerFor(windowed.picker, params || {}) };
  }
  if (windowed && windowed.days && windowed.days[method]) {
    return { result: daysFor(windowed.days[method] as DaysLibrary, params || {}) };
  }
  return { result: script.results[method] };
}

/**
 * Installed before the page's first script. It replaces `WebSocket` with a
 * relay that plays the script, `RTCPeerConnection` with a connection whose
 * channel answers from the script, and the page's random bytes with fixed
 * ones, so the proof the phone must give is known beforehand.
 *
 * The hello answer is `helloOf` whatever `results` holds for it, and replies
 * are text messages before `FRAMED_FROM`, as the engine sent them at that version.
 */
export function instrument(script: Script): string {
  const hello = helloOf(script);
  const served: Script = { ...script, results: { ...script.results, 'link.hello': hello } };
  const framed = hello.protocol >= FRAMED_FROM;
  return `
(function() {
  var script = ${JSON.stringify(served)};
  var framed = ${framed};
  var inviteRoom = ${JSON.stringify(INVITE_ROOM)};
  var fake = window.__fake = { sockets: [], peers: [], statuses: [], violations: [], statusPolls: 0 };

  var getRandomValues = crypto.getRandomValues.bind(crypto);
  crypto.getRandomValues = function(bytes) {
    if (bytes.length === 16) return bytes.fill(1);
    if (bytes.length === 32) return bytes.fill(2);
    return getRandomValues(bytes);
  };

  document.addEventListener('securitypolicyviolation', function(event) {
    fake.violations.push(event.violatedDirective + ' ' + event.blockedURI);
  });

  new MutationObserver(function() {
    var status = document.getElementById('status');
    var text = status ? status.textContent : null;
    if (text && fake.statuses[fake.statuses.length - 1] !== text) fake.statuses.push(text);
  }).observe(document, { subtree: true, childList: true, characterData: true });

  var feedPageFor = ${feedPageFor.toString()};
  var routesScreenFor = ${routesScreenFor.toString()};
  var pickerFor = ${pickerFor.toString()};
  var daysFor = ${daysFor.toString()};
  var answerAsk = ${answerAsk.toString()};
  var keepWrite = ${keepWrite.toString()};

  function FakeChannel() {
    this.readyState = 'connecting';
    this.sent = [];
    this.onopen = this.onclose = this.onmessage = null;
  }
  FakeChannel.prototype.open = function() {
    this.readyState = 'open';
    if (this.onopen) this.onopen();
  };
  FakeChannel.prototype.close = function() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    if (this.onclose) this.onclose();
  };
  FakeChannel.prototype.send = function(text) {
    var ask = JSON.parse(text);
    this.sent.push(ask);
    var channel = this;
    setTimeout(function() {
      var answer;
      if (ask.method === 'pair.prove') answer = { result: { phoneProof: script.phoneProof } };
      else if (ask.method === 'pair.status') answer = { result: ++fake.statusPolls < 2 ? 'waiting' : 'confirmed' };
      else if (ask.method === 'heatmap.tile') {
        var key = ask.params.z + '/' + ask.params.x + '/' + ask.params.y;
        answer = { result: { png: (script.tiles || {})[key] || (script.tilesByBase || {})[ask.params.base] || script.anyTile || null } };
      } else answer = answerAsk(script, ask.method, ask.params);
      if (answer.result !== undefined) keepWrite(script, ask.method, ask.params, answer.result);
      var reply = answer.error !== undefined
        ? { id: ask.id, error: answer.error }
        : answer.result === undefined
          ? { id: ask.id, error: 'unknown method ' + ask.method }
          : { id: ask.id, result: answer.result };
      if (!framed) {
        if (channel.onmessage) channel.onmessage({ data: JSON.stringify(reply) });
        return;
      }
      // Cut as the engine does: frames of at most 16 KiB, a 10-byte header each.
      var body = new TextEncoder().encode(JSON.stringify(reply));
      for (var seq = 0, at = 0; seq === 0 || at < body.length; seq++) {
        var chunk = body.subarray(at, at + 16374);
        at += chunk.length;
        var frame = new Uint8Array(10 + chunk.length);
        var view = new DataView(frame.buffer);
        view.setUint8(0, 1);
        view.setUint8(1, at >= body.length ? 2 : 0);
        view.setUint32(2, ask.id);
        view.setUint32(6, seq);
        frame.set(chunk, 10);
        if (channel.onmessage) channel.onmessage({ data: frame.buffer });
      }
    }, script.delayMs || 0);
  };

  function FakePeer() {
    this.iceGatheringState = 'complete';
    this.connectionState = 'new';
    this.localDescription = null;
    this.remoteDescription = null;
    this.channel = null;
    fake.peers.push(this);
  }
  FakePeer.generateCertificate = function() {
    return Promise.resolve({ expires: Date.now() + 1e11 });
  };
  FakePeer.prototype.createDataChannel = function() {
    this.channel = new FakeChannel();
    fake.channel = this.channel;
    return this.channel;
  };
  FakePeer.prototype.createOffer = function() {
    return Promise.resolve({
      type: 'offer',
      sdp: 'v=0\\r\\na=fingerprint:' + script.browserFingerprint.replace(' ', ' ') + '\\r\\n'
    });
  };
  FakePeer.prototype.setLocalDescription = function(description) {
    this.localDescription = description;
    return Promise.resolve();
  };
  FakePeer.prototype.setRemoteDescription = function(description) {
    this.remoteDescription = description;
    var channel = this.channel;
    if (channel) setTimeout(function() { channel.open(); }, 0);
    return Promise.resolve();
  };
  FakePeer.prototype.getStats = function() {
    return Promise.resolve(new Map(script.stats.map(function(row) { return [row.id, row]; })));
  };
  FakePeer.prototype.addEventListener = function() {};
  FakePeer.prototype.close = function() { this.connectionState = 'closed'; };
  window.RTCPeerConnection = FakePeer;

  function FakeSocket(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.onmessage = this.onclose = null;
    fake.sockets.push(this);
    var socket = this;
    var room = url.slice(url.lastIndexOf('/') + 1);
    var phone = room === inviteRoom ? script.invite : script.linked;
    this.phone = phone;
    if (phone) setTimeout(function() { socket.receive({ type: 'peer' }); }, 0);
  }
  FakeSocket.prototype.receive = function(message) {
    if (this.readyState === 3 || !this.onmessage) return;
    this.onmessage({ data: JSON.stringify(message) });
  };
  FakeSocket.prototype.send = function(text) {
    var message = JSON.parse(text);
    this.sent.push(message);
    var socket = this;
    if (message.type === 'offer' && this.phone) {
      setTimeout(function() {
        socket.receive({
          type: 'answer',
          sdp: 'v=0\\r\\na=fingerprint:' + socket.phone.fingerprint + '\\r\\n'
        });
      }, 0);
    }
  };
  FakeSocket.prototype.close = function() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    if (this.onclose) this.onclose();
  };
  window.WebSocket = FakeSocket;
})();
`;
}
