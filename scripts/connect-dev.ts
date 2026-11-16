#!/usr/bin/env tsx
// Serves the connect page on localhost with the scripted phone in place of a
// handset, and reloads the browser when the page's source changes. The page is
// built by `scripts/build-connect-page.mjs`, the build the deploy runs, into a
// scratch directory; the deploy's output is never touched and carries none of
// what this adds. The phone shim is a script the served page loads first, so
// the page's own content security policy still holds.
//
// Usage: npm run connect:dev [-- --port 5173]
//
// The phone is chosen by the page's query: `?phone=demo` (default),
// `unpaired`, `failing`, `slow` (each reply delayed) or `old` (a phone at the
// oldest protocol the page speaks, with only the first reads). Basemap tiles
// load from the network as in production.

import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';

import {
  phoneScript,
  isPhoneKind,
  PHONE_KINDS,
} from '../src/__tests__/__shared__/connectPhoneScripts';
import { instrument } from '../src/__tests__/__shared__/connectPhoneShim';

const ROOT = resolve(__dirname, '..');
const BUILD = join(ROOT, 'scripts/build-connect-page.mjs');
/** What a rebuild reads: the page, and the app modules it imports. */
const WATCHED = ['web/connect', 'src', 'modules/veloqrs/src', 'modules/veloqrs/assets/basemap'];
const DEBOUNCE_MS = 150;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
} as const;

const typeOfExtension = (extension: string): string =>
  (TYPES as Record<string, string | undefined>)[extension] ?? 'application/octet-stream';

const RELOAD = `new EventSource('/__dev/events').addEventListener('reload', () => location.reload());\n`;

interface Reply {
  status: number;
  type: string;
  body: string | Buffer;
}

export interface ConnectDev {
  url: string;
  /** How many builds have been served, the first included. */
  builds: () => number;
  close: () => Promise<void>;
}

function runBuild(root: string, out: string): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [BUILD, '--root', root, '--out', out, '--plain'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', fail);
    child.on('close', (code) =>
      code === 0 ? done() : fail(new Error(output.trim() || `build exited ${code}`))
    );
  });
}

/** The page with the shim loaded first and the reload listener last. */
export function withDevScripts(page: string, phone: string): string {
  return page
    .replace('<head>', `<head>\n    <script src="/__dev/shim.js?phone=${phone}"></script>`)
    .replace('</body>', '  <script src="/__dev/reload.js"></script>\n  </body>');
}

export async function startConnectDev(
  options: { root?: string; port?: number; log?: (line: string) => void } = {}
): Promise<ConnectDev> {
  const root = options.root ?? ROOT;
  const log = options.log ?? (() => undefined);
  const scratch = await mkdtemp(join(tmpdir(), 'connect-dev-'));
  const clients = new Set<ServerResponse>();
  let serving = '';
  let served = 0;
  let generation = 0;
  let wanted = 1;
  let working: Promise<void> = Promise.resolve();

  const rebuild = async (): Promise<void> => {
    while (generation < wanted) {
      const target = wanted;
      const out = join(scratch, `build-${target}`);
      try {
        await runBuild(root, out);
        const previous = serving;
        serving = out;
        served += 1;
        if (previous) await rm(previous, { recursive: true, force: true });
        log(`built ${target}`);
        for (const client of clients) client.write('event: reload\ndata: now\n\n');
      } catch (error) {
        log(`build failed, still serving the last good one: ${(error as Error).message}`);
      }
      generation = target;
    }
  };
  const request = () => {
    wanted += 1;
    working = working.then(rebuild);
  };
  await rebuild();
  if (!serving) {
    await rm(scratch, { recursive: true, force: true });
    throw new Error('the connect page did not build');
  }

  const send = (res: ServerResponse, status: number, type: string, body: string | Buffer) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };

  /** The answer to one request for the page, its files or the dev scripts. */
  const answer = async (url: URL): Promise<Reply> => {
    const phone = url.searchParams.get('phone') ?? 'demo';
    const unknown: Reply = {
      status: 400,
      type: TYPES['.txt'],
      body: `no such phone: ${phone}; try ${PHONE_KINDS.join(', ')}`,
    };
    if (url.pathname === '/__dev/reload.js')
      return { status: 200, type: TYPES['.js'], body: RELOAD };
    if (url.pathname === '/__dev/shim.js') {
      if (!isPhoneKind(phone)) return unknown;
      return { status: 200, type: TYPES['.js'], body: instrument(await phoneScript(phone)) };
    }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (relative === 'index.html' && !isPhoneKind(phone)) return unknown;
    const file = normalize(join(serving, relative));
    const shared = relative === 'icon.png' ? join(root, 'docs/icon.png') : null;
    if (!shared && file !== serving && !file.startsWith(serving + sep)) {
      return { status: 403, type: TYPES['.txt'], body: 'outside the page' };
    }
    try {
      const bytes = await readFile(shared ?? file);
      const type = typeOfExtension(extname(relative));
      const body = relative === 'index.html' ? withDevScripts(bytes.toString(), phone) : bytes;
      return { status: 200, type, body };
    } catch {
      return { status: 404, type: TYPES['.txt'], body: 'not found' };
    }
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/__dev/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write(': open\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    void answer(url).then((reply) => send(res, reply.status, reply.type, reply.body));
  });
  await new Promise<void>((ready) => server.listen(options.port ?? 0, '127.0.0.1', ready));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('the server has no port');

  let timer: NodeJS.Timeout | undefined;
  const watchers: FSWatcher[] = WATCHED.map((dir) =>
    watch(join(root, dir), { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(request, DEBOUNCE_MS);
    })
  );

  return {
    url: `http://localhost:${address.port}/`,
    builds: () => served,
    close: async () => {
      clearTimeout(timer);
      timer = undefined;
      for (const watcher of watchers) watcher.close();
      for (const client of clients) client.end();
      await new Promise((done) => server.close(done));
      server.closeAllConnections();
      await working;
      await rm(scratch, { recursive: true, force: true });
    },
  };
}

async function main(): Promise<void> {
  const at = process.argv.indexOf('--port');
  const port = at === -1 ? 5173 : Number(process.argv[at + 1]);
  const dev = await startConnectDev({ port, log: (line) => console.log(`connect-dev: ${line}`) });
  console.log(`connect-dev: ${dev.url}  (?phone=${PHONE_KINDS.join('|')})`);
}

if (process.argv[1] && /connect-dev\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(`connect-dev: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
