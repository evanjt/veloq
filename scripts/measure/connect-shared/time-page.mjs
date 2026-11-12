// Time a page's first paint and first render in a headless Chromium, served from memory on the
// origin the connect page deploys on, optionally with the CPU slowed to stand in for a mid laptop.
//
//   node time-page.mjs <dir with index.html> [runs=7] [cpu=1]
//
// Prints the median and spread of: first-contentful-paint, the page's own `window.__rendered`
// mark (set by the entries here after two animation frames), and the script time Chromium
// accounts to the load. The browser is driven over the DevTools protocol on a pipe.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

const noMark = process.argv.includes('--no-mark');
const [dir, runsArg = '7', cpuArg = '1'] = process.argv.slice(2).filter((a) => a !== '--no-mark');
const runs = Number(runsArg);
const cpu = Number(cpuArg);
const ORIGIN = 'https://veloq.fit';
const PATH = '/connect/';
const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  wasm: 'application/wasm',
  json: 'application/json',
  ttf: 'font/ttf',
  png: 'image/png',
};

function chromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try {
      return execFileSync('which', [name], { encoding: 'utf8' }).trim();
    } catch {
      /* next */
    }
  }
  throw new Error('no Chromium');
}

class Pipe {
  constructor(input, output) {
    this.input = input;
    this.next = 1;
    this.pending = new Map();
    this.listeners = new Map();
    let buffer = '';
    output.setEncoding('utf8');
    output.on('data', (text) => {
      buffer += text;
      let at;
      while ((at = buffer.indexOf('\0')) !== -1) {
        const message = JSON.parse(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
        if (message.id) {
          const p = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (!p) continue;
          if (message.error) p.reject(new Error(message.error.message));
          else p.resolve(message.result);
        } else
          for (const l of this.listeners.get(message.method) ?? [])
            l(message.params, message.sessionId);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.next++;
    this.input.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, listener) {
    (this.listeners.get(method) ?? this.listeners.set(method, []).get(method)).push(listener);
  }
}

const profile = mkdtempSync(join(tmpdir(), 'time-page-'));
const child = spawn(
  chromium(),
  [
    '--headless',
    '--no-sandbox',
    '--no-first-run',
    '--disable-extensions',
    '--mute-audio',
    `--user-data-dir=${profile}`,
    '--remote-debugging-pipe',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }
);
const pipe = new Pipe(child.stdio[3], child.stdio[4]);
for (const s of [child.stdio[3], child.stdio[4]]) s.on('error', () => {});
await pipe.send('Browser.getVersion');

const { targetId } = await pipe.send('Target.createTarget', {
  url: 'about:blank',
});
const { sessionId } = await pipe.send('Target.attachToTarget', {
  targetId,
  flatten: true,
});
const send = (m, p) => pipe.send(m, p, sessionId);
pipe.on('Fetch.requestPaused', (params, sid) => {
  const url = new URL(params.request.url);
  let name = url.pathname.startsWith(PATH) ? url.pathname.slice(PATH.length) : null;
  if (name === '') name = 'index.html';
  const file = name ? join(dir, name) : null;
  if (!file || !existsSync(file)) {
    pipe.send(
      'Fetch.fulfillRequest',
      { requestId: params.requestId, responseCode: 404, body: '' },
      sid
    );
    return;
  }
  const type = TYPES[extname(file).slice(1)] ?? 'application/octet-stream';
  pipe.send(
    'Fetch.fulfillRequest',
    {
      requestId: params.requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'Content-Type', value: type },
        { name: 'Cache-Control', value: 'no-store' },
      ],
      body: readFileSync(file).toString('base64'),
    },
    sid
  );
});
const errors = [];
pipe.on('Runtime.exceptionThrown', (p) =>
  errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text)
);
pipe.on('Runtime.consoleAPICalled', (p) => {
  if (p.type === 'error') errors.push(p.args.map((a) => a.value ?? a.description).join(' '));
});
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
await send('Page.enable');
await send('Performance.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 800,
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Emulation.setCPUThrottlingRate', { rate: cpu });

const evaluate = async (expression) =>
  (
    await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
  ).result.value;
const samples = [];
for (let i = 0; i < runs; i++) {
  await send('Page.navigate', { url: 'about:blank' });
  await new Promise((r) => setTimeout(r, 150));
  await send('Page.navigate', { url: ORIGIN + PATH });
  const deadline = Date.now() + 30000;
  let done = false;
  while (!done && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
    done = await evaluate(
      `Boolean(window.__rendered || (${noMark} && document.readyState === "complete" && performance.getEntriesByName("first-contentful-paint").length))`
    );
    if (!done && errors.length) break;
  }
  const reading = await evaluate(`JSON.stringify({
    fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
    rendered: window.__rendered ?? null,
    extra: window.__extra ?? null,
    domInteractive: performance.getEntriesByType('navigation')[0]?.domInteractive ?? null,
  })`);
  const metrics = Object.fromEntries(
    (await send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value])
  );
  samples.push({
    ...JSON.parse(reading),
    script: metrics.ScriptDuration * 1000,
    layout: metrics.LayoutDuration * 1000,
    heap: metrics.JSHeapUsedSize / 1e6,
  });
}
if (errors.length)
  console.log('page errors:\n  ' + [...new Set(errors)].slice(0, 5).join('\n  ').slice(0, 2000));
child.kill('SIGKILL');
rmSync(profile, { recursive: true, force: true });
const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const spread = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? [s[0], s[s.length - 1]] : null;
};
const show = (k) => {
  const m = median(samples.map((s) => s[k]));
  const sp = spread(samples.map((s) => s[k]));
  return m == null ? `${k}: -` : `${k} ${m.toFixed(1)} [${sp[0].toFixed(1)}..${sp[1].toFixed(1)}]`;
};
console.log(
  `${dir}  cpu x${cpu}  n=${runs}  ms:  ${['fcp', 'rendered', 'extra', 'domInteractive', 'script', 'layout'].map(show).join('   ')}   heapMB ${median(samples.map((s) => s.heap))?.toFixed(1)}`
);
