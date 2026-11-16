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
  /** What `heatmap.tile` answers for a tile `tiles` does not list; without it that tile holds no heat. */
  anyTile?: string;
  /** The name the phone gives itself in its hello, if it gives one. */
  device?: string;
  /** How long the phone takes to answer each ask, in milliseconds; none when absent. */
  delayMs?: number;
  /** The protocol the phone's hello names; the page's newest when absent. */
  protocol?: number;
  /** The rows the browser's own `getStats()` report holds for the open connection. */
  stats: Record<string, unknown>[];
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
  script: Pick<Script, 'results' | 'byActivity'>,
  method: string,
  params: Record<string, unknown> | undefined
): { result: unknown; error?: undefined } | { error: string; result?: undefined } {
  // The entity an ask names: an activity, a route group, a section or an exercise category.
  const keys = ['id', 'activityId', 'groupId', 'sectionId', 'exerciseCategory'];
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

  var answerAsk = ${answerAsk.toString()};

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
        answer = { result: { png: (script.tiles || {})[key] || script.anyTile || null } };
      } else answer = answerAsk(script, ask.method, ask.params);
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
