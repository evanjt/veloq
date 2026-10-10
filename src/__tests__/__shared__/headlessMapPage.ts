/**
 * Runs a built map page in a headless Chromium, with WebGL drawn in software
 * by SwiftShader, and reports every map error and uncaught page error it
 * raises.
 *
 * The browser is driven over the DevTools protocol on a pipe, so nothing
 * listens on a port. Every request the page makes is answered here, the page
 * document included, so a run reaches no network and a missing tile can never
 * be mistaken for a renderer fault: the page is served on the origin the app
 * loads it on, a TileJSON names tiles under that answer, an image is a grey
 * PNG, a protobuf is empty and a JSON document is `{}`.
 *
 * Chromium is found from `CHROME_PATH`, then on `PATH`.
 */

import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { crc32, deflateSync } from 'node:zlib';

const BROWSERS = ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome'];

/** The first Chromium found, or null. */
export function findChromium(): string | null {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const name of BROWSERS) {
    try {
      return execFileSync('which', [name], { encoding: 'utf8' }).trim();
    } catch {
      // Not installed under this name.
    }
  }
  return null;
}

/** A 256 px square PNG of one grey, which decodes as a raster tile and a flat DEM. */
function greyPng(): Buffer {
  const size = 256;
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 128)]);
  const pixels = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Installed before the page's first script. It stands in for the React Native
 * bridge, and wraps the renderer's map `fire` as the renderer is defined, so
 * every map error is recorded whatever the page's own handler chooses to drop.
 */
const INSTRUMENT = `
(function() {
  var smoke = window.__smoke = { mapErrors: [], posted: [] };
  window.ReactNativeWebView = {
    postMessage: function(message) {
      try { smoke.posted.push(JSON.parse(message)); } catch (e) { smoke.posted.push(message); }
    }
  };
  var renderer;
  Object.defineProperty(window, 'maplibregl', {
    configurable: true,
    get: function() { return renderer; },
    set: function(value) {
      renderer = value;
      if (!value || !value.Map) return;
      var fire = value.Map.prototype.fire;
      value.Map.prototype.fire = function(event) {
        if (event && event.type === 'error') {
          var error = event.error;
          var message = error ? (error.message || String(error)) : String(event.message || 'unknown');
          if (event.sourceId) message += ' [' + event.sourceId + ']';
          if (error && error.url) message += ' ' + error.url;
          smoke.mapErrors.push(message);
        }
        return fire.apply(this, arguments);
      };
    }
  });
})();
`;

/** The page with `script` run straight after the renderer's own tag. */
function withAfterRenderer(html: string, script: string | undefined): string {
  if (!script) return html;
  const start = html.indexOf('<script id="maplibre-gl">');
  const end = html.indexOf('</script>', start) + '</script>'.length;
  return `${html.slice(0, end)}<script>${script}</script>${html.slice(end)}`;
}

/** What the stand-in network answers one request with. */
function answer(
  url: string,
  served: OpenPageOptions,
  png: Buffer
): { contentType: string; body: Buffer | string } {
  const path = url.split(/[?#]/)[0];
  if (url === served.url) {
    return { contentType: 'text/html', body: withAfterRenderer(served.html, served.afterRenderer) };
  }
  if (served.tileJsonUrls.includes(url)) {
    const tileJson = {
      tilejson: '3.0.0',
      tiles: [`${new URL(served.url).origin}/smoke-tiles/{z}/{x}/{y}.pbf`],
      minzoom: 0,
      maxzoom: 14,
    };
    return { contentType: 'application/json', body: JSON.stringify(tileJson) };
  }
  if (/\.(pbf|mvt)$/i.test(path)) return { contentType: 'application/x-protobuf', body: '' };
  if (/\.json$/i.test(path)) return { contentType: 'application/json', body: '{}' };
  return { contentType: 'image/png', body: png };
}

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

type Listener = (params: Record<string, unknown>, sessionId?: string) => void;

/** A DevTools protocol connection over Chromium's `--remote-debugging-pipe`. */
class Protocol {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Map<string, Listener[]>();
  private buffer = '';

  constructor(
    private readonly input: Writable,
    output: Readable
  ) {
    output.setEncoding('utf8');
    output.on('data', (text: string) => {
      this.buffer += text;
      let end = this.buffer.indexOf('\0');
      while (end >= 0) {
        this.receive(JSON.parse(this.buffer.slice(0, end)));
        this.buffer = this.buffer.slice(end + 1);
        end = this.buffer.indexOf('\0');
      }
    });
  }

  private receive(message: {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: { message: string };
    sessionId?: string;
  }) {
    if (message.id !== undefined) {
      const waiting = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (!waiting) return;
      if (message.error) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result ?? {});
      return;
    }
    for (const listener of this.listeners.get(message.method ?? '') ?? []) {
      listener(message.params ?? {}, message.sessionId);
    }
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.input.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    });
  }

  on(method: string, listener: Listener) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
  }

  failAll(error: Error) {
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
  }
}

export interface OpenPageOptions {
  html: string;
  /** The origin the app loads the page on, and so where it is served. */
  url: string;
  /** TileJSON urls the page's styles name, answered with a tile template. */
  tileJsonUrls: string[];
  /** Page script run after the renderer is defined and before the page's own. */
  afterRenderer?: string | undefined;
}

export interface MapPage {
  /** Every map error and uncaught page error so far, in order. */
  errors: () => string[];
  /** What the page posted to the host bridge, parsed. */
  posted: () => Promise<unknown[]>;
  /** Evaluates an expression in the page and awaits it, rejecting on a throw. */
  evaluate: <T = unknown>(expression: string) => Promise<T>;
  close: () => Promise<void>;
}

export interface Chromium {
  open: (options: OpenPageOptions) => Promise<MapPage>;
  close: () => Promise<void>;
}

export async function launchChromium(executable: string): Promise<Chromium> {
  const profile = mkdtempSync(join(tmpdir(), 'map-page-smoke-'));
  const child: ChildProcess = spawn(
    executable,
    [
      '--headless',
      '--no-sandbox',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
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

  const png = greyPng();
  const pages = new Map<string, { errors: string[]; served: OpenPageOptions }>();

  protocol.on('Runtime.exceptionThrown', (params, sessionId) => {
    const details = params.exceptionDetails as {
      text: string;
      exception?: { description?: string };
    };
    pages
      .get(sessionId ?? '')
      ?.errors.push(`page error: ${details.exception?.description ?? details.text}`);
  });

  protocol.on('Fetch.requestPaused', (params, sessionId) => {
    const page = pages.get(sessionId ?? '');
    if (!page) return;
    const { contentType, body } = answer((params.request as { url: string }).url, page.served, png);
    protocol
      .send(
        'Fetch.fulfillRequest',
        {
          requestId: params.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'Content-Type', value: contentType },
            { name: 'Access-Control-Allow-Origin', value: '*' },
          ],
          body: Buffer.from(body).toString('base64'),
        },
        sessionId
      )
      .catch(() => {});
  });

  return {
    async open(served) {
      const { targetId } = await protocol.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = (await protocol.send('Target.attachToTarget', {
        targetId,
        flatten: true,
      })) as { sessionId: string };
      const errors: string[] = [];
      pages.set(sessionId, { errors, served });
      const send = (method: string, params: Record<string, unknown> = {}) =>
        protocol.send(method, params, sessionId);

      await send('Runtime.enable');
      await send('Page.enable');
      await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
      await send('Emulation.setDeviceMetricsOverride', {
        width: 320,
        height: 320,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await send('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT });

      const loaded = new Promise<void>((resolve) => {
        protocol.on('Page.loadEventFired', (_params, from) => {
          if (from === sessionId) resolve();
        });
      });
      await send('Page.navigate', { url: served.url });
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
        errors: () => errors,
        posted: () => evaluate<unknown[]>('window.__smoke.posted'),
        evaluate,
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
