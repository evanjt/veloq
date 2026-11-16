/**
 * Scenario: `npm run connect:dev` serves the connect page with a scripted
 * phone in place of a handset, for designing pages without one.
 *
 * Expected behaviour: the served page loads the phone shim and the deploy
 * build does not, each phone named by the query gets its own script and an
 * unknown one is refused, and a source edit is rebuilt and served.
 */

import { spawnSync } from 'node:child_process';
import { get as httpGet } from 'node:http';
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { startConnectDev } from '../../../scripts/connect-dev';
import type { ConnectDev } from '../../../scripts/connect-dev';
import methods from '../../../web/connect/methods.json';
import { OLD_METHODS } from '../__shared__/connectPhoneScripts';

const ROOT = resolve(__dirname, '../../..');
const SOURCE = join(ROOT, 'web/connect/connect.css');
const protocolMethods = (methods as { methods: { name: string }[] }).methods.map((m) => m.name);

jest.setTimeout(120_000);

let dev: ConnectDev;
let original: string;

beforeAll(async () => {
  original = readFileSync(SOURCE, 'utf8');
  dev = await startConnectDev();
});

afterAll(async () => {
  writeFileSync(SOURCE, original);
  await dev.close();
});

interface Reply {
  status: number;
  text: () => Promise<string>;
}

/** Jest's environment replaces `fetch`, so the server is asked over `node:http`. */
const get = (path: string): Promise<Reply> =>
  new Promise((done, fail) => {
    httpGet(new URL(path, dev.url), (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => done({ status: res.statusCode ?? 0, text: async () => body }));
    }).on('error', fail);
  });

describe('connect dev server', () => {
  it('serves the shim in the page, and the deploy build has none', async () => {
    const page = await (await get('/?phone=failing')).text();
    expect(page).toContain('/__dev/shim.js?phone=failing');
    expect(page.indexOf('/__dev/shim.js')).toBeLessThan(page.indexOf('maplibre-'));

    const shim = await (await get('/__dev/shim.js?phone=failing')).text();
    expect(shim).toContain('FakePeer');

    const out = mkdtempSync(join(tmpdir(), 'connect-deploy-'));
    try {
      const built = spawnSync(
        'node',
        [join(ROOT, 'scripts/build-connect-page.mjs'), '--out', out],
        {
          cwd: ROOT,
          encoding: 'utf8',
        }
      );
      expect(built.status).toBe(0);
      const deployed = readFileSync(join(out, 'index.html'), 'utf8');
      expect(deployed).not.toContain('__dev');
      for (const name of readdirSync(out).filter((n) => n.endsWith('.js'))) {
        expect(readFileSync(join(out, name), 'utf8')).not.toContain('FakePeer');
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('gives each phone its own script and refuses an unknown one', async () => {
    const slow = await (await get('/__dev/shim.js?phone=slow')).text();
    const old = await (await get('/__dev/shim.js?phone=old')).text();
    const unpaired = await (await get('/__dev/shim.js?phone=unpaired')).text();
    expect(slow).toContain('"delayMs":1500');
    expect(old).toContain('"protocol":2');
    for (const method of protocolMethods.filter((name) => !OLD_METHODS.includes(name))) {
      expect(old).not.toContain(`"${method}"`);
    }
    expect(unpaired).toContain('"invite":null');

    expect((await get('/?phone=nonsense')).status).toBe(400);
    expect((await get('/__dev/shim.js?phone=nonsense')).status).toBe(400);
  });

  it('refuses a path outside the build', async () => {
    const response = await get('/..%2F..%2Fpackage.json');
    expect(response.status).not.toBe(200);
  });

  it('rebuilds on a source edit and serves the result', async () => {
    const before = dev.builds();
    const marker = '.dev-server-edit-marker{color:red}';
    appendFileSync(SOURCE, `\n${marker}\n`);
    const deadline = Date.now() + 60_000;
    while (dev.builds() === before && Date.now() < deadline) {
      await new Promise((tick) => setTimeout(tick, 100));
    }
    expect(dev.builds()).toBeGreaterThan(before);

    const page = await (await get('/')).text();
    const sheet = /href="(connect-[^"]+\.css)"/.exec(page)?.[1];
    expect(sheet).toBeDefined();
    expect(await (await get(`/${sheet}`)).text()).toContain('dev-server-edit-marker');
  });
});
