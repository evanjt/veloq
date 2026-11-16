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

import { instrument } from './connectPhoneShim';
import type { Script } from './connectPhoneShim';
import { Protocol, greyPng } from './headlessMapPage';

export { findChromium } from './headlessMapPage';
export { INVITE_ROOM } from './connectPhoneShim';
export type { Script } from './connectPhoneShim';

const ROOT = resolve(__dirname, '../../..');

/** Where the deploy serves the page. */
export const PAGE_URL = 'https://veloq.fit/connect/';
const PAGE_ORIGIN = 'https://veloq.fit';

/** The basemap host the page's map draws from, answered here so a run reaches no network. */
const BASEMAP_ORIGIN = 'https://tiles.openfreemap.org';

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  map: 'application/json',
  json: 'application/json',
};

export interface ConnectPage {
  /** Console errors, uncaught page errors and content security policy violations so far. */
  errors: () => string[];
  /** Evaluates an expression in the page and awaits it, rejecting on a throw. */
  evaluate: <T = unknown>(expression: string) => Promise<T>;
  /** Waits until `expression` is truthy in the page, and returns it. */
  until: <T = unknown>(expression: string, limitMs?: number) => Promise<T>;
  /** The viewport as a PNG. */
  screenshot: () => Promise<Buffer>;
  /**
   * A left-button press at `from`, moves through `steps` points along the way to `to`, and a
   * release at `to`, as the pointer would make them. `whileHeld` runs once the pointer is at
   * `to` and before it is released.
   */
  drag: (from: Point, to: Point, options?: DragOptions) => Promise<void>;
  close: () => Promise<void>;
}

export interface DragOptions {
  steps?: number;
  whileHeld?: () => Promise<void>;
}

/** A point in CSS pixels of the viewport. */
export interface Point {
  x: number;
  y: number;
}

/** The window the page is opened in; the default is 1280 by 800 in the light scheme. */
export interface Viewport {
  width: number;
  height: number;
  scheme?: 'light' | 'dark';
}

export interface ConnectBrowser {
  open: (script: Script, languages?: string, viewport?: Viewport) => Promise<ConnectPage>;
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

/** Resolves once no process is left in the group, or after a few seconds. */
async function untilGroupGone(group: number, limitMs = 5_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      process.kill(-group, 0);
    } catch {
      return;
    }
    if (Date.now() - started > limitMs) return;
    await new Promise((again) => setTimeout(again, 20));
  }
}

export async function launchConnectBrowser(
  executable: string,
  distribution: string
): Promise<ConnectBrowser> {
  const profile = mkdtempSync(join(tmpdir(), 'connect-page-profile-'));
  // Its own process group, so closing it also stops the renderers and helpers it started.
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
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], detached: true }
  );
  const exited = new Promise<void>((done) => child.once('exit', () => done()));
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
    const headers: { name: string; value: string }[] = [];
    let body: Buffer | string = '';
    const name = url.pathname.startsWith('/connect/')
      ? url.pathname.slice('/connect/'.length)
      : null;
    if (url.origin === BASEMAP_ORIGIN) {
      // The basemap host allows any origin to read its tiles, glyphs and sprite.
      headers.push({ name: 'Access-Control-Allow-Origin', value: '*' });
      const path = url.pathname;
      if (/\.(pbf|mvt)$/i.test(path)) contentType = 'application/x-protobuf';
      else if (/\.png$/i.test(path)) {
        contentType = 'image/png';
        body = icon;
      } else {
        contentType = 'application/json';
        body = /^\/(planet|natural_earth)$/.test(path)
          ? JSON.stringify({
              tilejson: '3.0.0',
              tiles: [`${BASEMAP_ORIGIN}${path}/20260101/{z}/{x}/{y}.pbf`],
              minzoom: 0,
              maxzoom: 14,
            })
          : '{}';
      }
    } else if (url.origin === PAGE_ORIGIN && url.pathname === '/icon.png') {
      contentType = 'image/png';
      body = icon;
    } else if (url.origin === PAGE_ORIGIN && name !== null) {
      const file = name === '' ? 'index.html' : name;
      try {
        const chunk = /^locales\/[A-Za-z0-9-]+\.json$/.test(file);
        if ((file.includes('/') && !chunk) || file.includes('..'))
          throw new Error('outside the page');
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
          responseHeaders: [{ name: 'Content-Type', value: contentType }, ...headers],
          body: Buffer.from(body).toString('base64'),
        },
        sessionId
      )
      .catch(() => {});
  });

  return {
    async open(script, languages, viewport) {
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
        width: viewport?.width ?? 1280,
        height: viewport?.height ?? 800,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: viewport?.scheme ?? 'light' }],
      });
      if (languages) {
        // The header and navigator.languages both come from the override's acceptLanguage.
        await send('Emulation.setUserAgentOverride', {
          userAgent: (await protocol.send('Browser.getVersion')).userAgent as string,
          acceptLanguage: languages,
        });
      }
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
        async screenshot() {
          const shot = (await send('Page.captureScreenshot', { format: 'png' })) as {
            data: string;
          };
          return Buffer.from(shot.data, 'base64');
        },
        async drag(from, to, options = {}) {
          const steps = options.steps ?? 10;
          const at = (type: string, point: Point, buttons: number) =>
            send('Input.dispatchMouseEvent', {
              type,
              x: point.x,
              y: point.y,
              button: 'left',
              buttons,
              clickCount: 1,
            });
          await at('mouseMoved', from, 0);
          await at('mousePressed', from, 1);
          for (let i = 1; i <= steps; i++) {
            await at(
              'mouseMoved',
              {
                x: from.x + ((to.x - from.x) * i) / steps,
                y: from.y + ((to.y - from.y) * i) / steps,
              },
              1
            );
          }
          await options.whileHeld?.();
          await at('mouseReleased', to, 0);
        },
        async close() {
          pages.delete(sessionId);
          await protocol.send('Target.closeTarget', { targetId }).catch(() => {});
        },
      };
    },
    async close() {
      if (child.pid !== undefined) {
        const group = child.pid;
        try {
          process.kill(-group, 'SIGKILL');
        } catch {
          // The group has already gone.
        }
        await exited;
        await untilGroupGone(group);
      }
      // The profile is removed only once no process of the browser is left to write to it.
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
