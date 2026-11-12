/**
 * Runs the built connect page in a headless Chromium and stands in for
 * everything outside it: the page and its files are served from memory on the
 * origin it is deployed on, so its content security policy is enforced as it
 * is deployed, and the relay and the phone are scripts the page's own
 * `WebSocket` and `RTCPeerConnection` are replaced by before its scripts run.
 * IndexedDB is the browser's own, in a fresh profile.
 *
 * The browser is driven over the DevTools protocol on a pipe, so nothing
 * listens on a port, and a run reaches no network.
 */

import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import { Protocol, greyPng } from './headlessMapPage';
import { PAGE_PROTOCOL } from '../../../web/connect/link';

export { findChromium } from './headlessMapPage';

const ROOT = resolve(__dirname, '../../..');

/** Where the deploy serves the page. */
export const PAGE_URL = 'https://veloq.fit/connect/';
const PAGE_ORIGIN = 'https://veloq.fit';

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  map: 'application/json',
};

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
}

export interface ConnectPage {
  /** Console errors, uncaught page errors and content security policy violations so far. */
  errors: () => string[];
  /** Evaluates an expression in the page and awaits it, rejecting on a throw. */
  evaluate: <T = unknown>(expression: string) => Promise<T>;
  /** Waits until `expression` is truthy in the page, and returns it. */
  until: <T = unknown>(expression: string, limitMs?: number) => Promise<T>;
  close: () => Promise<void>;
}

export interface ConnectBrowser {
  open: (script: Script) => Promise<ConnectPage>;
  close: () => Promise<void>;
}

/** The page built the way the deploy builds it, into a scratch directory. */
export function buildPage(): { dir: string; remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'connect-page-'));
  const built = spawnSync('node', [join(ROOT, 'scripts/build-connect-page.mjs'), '--out', dir], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (built.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`the connect page did not build: ${built.stdout}${built.stderr}`);
  }
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Installed before the page's first script. It replaces `WebSocket` with a
 * relay that plays the script, `RTCPeerConnection` with a connection whose
 * channel answers from the script, and the page's random bytes with fixed
 * ones, so the proof the phone must give is known beforehand.
 */
function instrument(script: Script): string {
  return `
(function() {
  var script = ${JSON.stringify(script)};
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
      var result;
      if (ask.method === 'pair.prove') result = { phoneProof: script.phoneProof };
      else if (ask.method === 'pair.status') result = ++fake.statusPolls < 2 ? 'waiting' : 'confirmed';
      else if (ask.method === 'link.hello') result = { protocol: ${PAGE_PROTOCOL}, app: 'test', methods: script.methods };
      else result = script.results[ask.method];
      var reply = result === undefined
        ? { id: ask.id, error: 'unknown method ' + ask.method }
        : { id: ask.id, result: result };
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
    }, 0);
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

export async function launchConnectBrowser(
  executable: string,
  distribution: string
): Promise<ConnectBrowser> {
  const profile = mkdtempSync(join(tmpdir(), 'connect-page-profile-'));
  const child: ChildProcess = spawn(
    executable,
    [
      '--headless',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      `--user-data-dir=${profile}`,
      '--remote-debugging-pipe',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }
  );
  const protocol = new Protocol(child.stdio[3] as Writable, child.stdio[4] as Readable);
  child.on('exit', () => protocol.failAll(new Error('Chromium exited')));
  child.on('error', (error) =>
    protocol.failAll(new Error(`Chromium did not start: ${error.message}`))
  );
  await protocol.send('Browser.getVersion');

  const icon = greyPng();
  const pages = new Map<string, string[]>();

  const record = (sessionId: string | undefined, text: string) =>
    pages.get(sessionId ?? '')?.push(text);

  protocol.on('Runtime.exceptionThrown', (params, sessionId) => {
    const details = params.exceptionDetails as {
      text: string;
      exception?: { description?: string };
    };
    record(sessionId, `page error: ${details.exception?.description ?? details.text}`);
  });
  protocol.on('Runtime.consoleAPICalled', (params, sessionId) => {
    if (params.type !== 'error' && params.type !== 'assert') return;
    const args = params.args as { value?: unknown; description?: string }[];
    record(
      sessionId,
      `console.${params.type}: ${args.map((a) => a.value ?? a.description).join(' ')}`
    );
  });
  protocol.on('Log.entryAdded', (params, sessionId) => {
    const entry = params.entry as { level: string; text: string; url?: string };
    if (entry.level === 'error') record(sessionId, `log: ${entry.text} ${entry.url ?? ''}`);
  });

  protocol.on('Fetch.requestPaused', (params, sessionId) => {
    const request = params.request as { url: string };
    const url = new URL(request.url);
    let status = 200;
    let contentType = 'text/plain';
    let body: Buffer | string = '';
    const name = url.pathname.startsWith('/connect/')
      ? url.pathname.slice('/connect/'.length)
      : null;
    if (url.origin === PAGE_ORIGIN && url.pathname === '/icon.png') {
      contentType = 'image/png';
      body = icon;
    } else if (url.origin === PAGE_ORIGIN && name !== null) {
      const file = name === '' ? 'index.html' : name;
      try {
        if (file.includes('/') || file.includes('..')) throw new Error('outside the page');
        body = readFileSync(join(distribution, file));
        contentType = TYPES[file.slice(file.lastIndexOf('.') + 1)] ?? 'application/octet-stream';
      } catch {
        status = 404;
        record(sessionId, `the page asked for a file it does not ship: ${request.url}`);
      }
    } else {
      status = 404;
      record(sessionId, `the page reached beyond its own files: ${request.url}`);
    }
    protocol
      .send(
        'Fetch.fulfillRequest',
        {
          requestId: params.requestId,
          responseCode: status,
          responseHeaders: [{ name: 'Content-Type', value: contentType }],
          body: Buffer.from(body).toString('base64'),
        },
        sessionId
      )
      .catch(() => {});
  });

  return {
    async open(script) {
      const { targetId } = await protocol.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = (await protocol.send('Target.attachToTarget', {
        targetId,
        flatten: true,
      })) as { sessionId: string };
      const errors: string[] = [];
      pages.set(sessionId, errors);
      const send = (method: string, params: Record<string, unknown> = {}) =>
        protocol.send(method, params, sessionId);

      await send('Runtime.enable');
      await send('Log.enable');
      await send('Page.enable');
      await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
      await send('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await send('Page.addScriptToEvaluateOnNewDocument', { source: instrument(script) });

      const loaded = new Promise<void>((resolveLoaded) => {
        protocol.on('Page.loadEventFired', (_params, from) => {
          if (from === sessionId) resolveLoaded();
        });
      });
      await send('Page.navigate', { url: PAGE_URL });
      await loaded;

      const evaluate = async <T>(expression: string): Promise<T> => {
        const reply = (await send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        })) as {
          result: { value?: T };
          exceptionDetails?: { text: string; exception?: { description?: string } };
        };
        if (reply.exceptionDetails) {
          const { exception, text } = reply.exceptionDetails;
          throw new Error(exception?.description ?? text);
        }
        return reply.result.value as T;
      };

      return {
        errors: () => [...errors],
        evaluate,
        async until<T>(expression: string, limitMs = 10_000) {
          const started = Date.now();
          for (;;) {
            const value = await evaluate<T>(expression);
            if (value) return value;
            if (Date.now() - started > limitMs) {
              const seen = await evaluate<string>(
                'JSON.stringify({statuses: window.__fake.statuses, body: document.body.innerText})'
              );
              throw new Error(`the page never satisfied ${expression}: ${seen}`);
            }
            await new Promise((again) => setTimeout(again, 50));
          }
        },
        async close() {
          pages.delete(sessionId);
          await protocol.send('Target.closeTarget', { targetId }).catch(() => {});
        },
      };
    },
    async close() {
      child.kill('SIGKILL');
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
