/**
 * Scenario: the connect page is opened on a phone that is not paired, on a
 * phone that lists its methods and answers none of them, on a phone whose
 * channel closes under a page, and on a phone too old for the page.
 *
 * Expected behaviour: a browser with nothing kept shows the pairing page, the
 * code beside its three steps and the data note, centred in the content pane.
 * A link that fails after it connected keeps the shell, the sidebar and the
 * page on view, dimmed and inert under a banner that names the wait and offers
 * a retry. A retry from the banner tries the phone at once. A phone that needs
 * an update shows the update panel, and retry and unlink are in the account
 * menu as well.
 *
 * Runs with `npm run test:map-pages`, which needs a Chromium.
 */

import enGB from '../../i18n/locales/en-GB.json';
import { phoneScript, type PhoneKind } from '../__shared__/connectPhoneScripts';
import {
  buildPage,
  findChromium,
  launchConnectBrowser,
  type ConnectBrowser,
  type ConnectPage,
  type Script,
} from '../__shared__/headlessConnectPage';

const TIMEOUT_MS = 60_000;
const LINK_MS = 1_500;

const CONNECTED = `document.querySelector('#status[data-state="connected"]') !== null`;
const WAITING = `document.querySelector('#status[data-state="waiting"]') !== null`;
const ROUTE_ROWS = `document.querySelectorAll('#routes-page .row-thumb').length > 0`;
const VIEWPORT = { width: 1440, height: 900 };

const text = (selector: string) =>
  `(document.querySelector(${JSON.stringify(selector)})?.textContent ?? null)`;

const box = (selector: string) =>
  `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })()`;

const chromium = findChromium();
const describeWithChromium = chromium ? describe : describe.skip;

describeWithChromium('the connect page when the link is not up, in a headless Chromium', () => {
  let page: { dir: string; remove: () => void };
  let browser: ConnectBrowser;
  let open: ConnectPage[];

  beforeAll(() => {
    page = buildPage();
  }, TIMEOUT_MS);

  afterAll(() => page.remove());

  beforeEach(async () => {
    browser = await launchConnectBrowser(chromium as string, page.dir);
    open = [];
  }, TIMEOUT_MS);

  afterEach(async () => {
    for (const each of open) expect(each.errors()).toEqual([]);
    await browser.close();
  });

  async function visit(script: Script | PhoneKind, hash?: string): Promise<ConnectPage> {
    const resolved = typeof script === 'string' ? await phoneScript(script) : script;
    const visited = await browser.open(resolved, undefined, VIEWPORT);
    open.push(visited);
    if (hash) await visited.evaluate(`location.hash = ${JSON.stringify(hash)}`);
    return visited;
  }

  it(
    'lays the pairing page out as the code beside three steps and the data note, centred',
    async () => {
      const connect = await visit('unpaired');
      await connect.until(`document.querySelector('#pair #code') !== null`, TIMEOUT_MS);
      expect(await connect.evaluate(`document.querySelectorAll('#pair ol li').length`)).toBe(3);
      expect(await connect.evaluate(text('#pair .pair-data'))).toBe(enGB.connectPage.footer);

      const code = await connect.evaluate<{ left: number; right: number }>(box('#code'));
      const steps = await connect.evaluate<{ left: number; right: number }>(box('#pair ol'));
      expect(steps.left).toBeGreaterThan(code.right);

      const pair = await connect.evaluate<{ left: number; right: number }>(box('#pair'));
      const content = await connect.evaluate<{ left: number; right: number }>(box('#content'));
      expect(pair.right - pair.left).toBeLessThanOrEqual(960);
      expect(Math.abs(pair.left - content.left - (content.right - pair.right))).toBeLessThanOrEqual(
        2
      );

      expect(await connect.evaluate(`document.getElementById('rail')`)).toBeNull();
      expect(await connect.evaluate(`document.getElementById('link-banner')`)).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    'keeps the shell and the sidebar mounted under a banner when the phone fails',
    async () => {
      const connect = await visit('failing');
      await connect.until(`${WAITING} && document.querySelector('#rail') !== null`, TIMEOUT_MS);

      expect(await connect.evaluate(`document.querySelector('#topbar') !== null`)).toBe(true);
      expect(await connect.evaluate(`document.querySelector('#rail') !== null`)).toBe(true);
      expect(await connect.evaluate(text('#link-banner strong'))).toBe('Waiting for your phone');
      expect(await connect.evaluate(`document.querySelector('#link-retry') !== null`)).toBe(true);
      expect(
        await connect.evaluate(`document.querySelector('.page-body[data-dimmed]') !== null`)
      ).toBe(true);
      expect(
        await connect.evaluate(
          `document.querySelector('.page-body[data-dimmed]').hasAttribute('inert')`
        )
      ).toBe(true);
    },
    TIMEOUT_MS
  );

  it.each([
    ['#/activities', 'Activities'],
    ['#/routes', 'Routes'],
    ['#/recordings', 'Recordings'],
    ['#/live', 'Live session'],
    ['#/settings', 'Settings'],
  ])(
    'keeps %s on screen through a drop and makes the athlete wait under the banner',
    async (hash, title) => {
      const connect = await visit(await phoneScript('demo'), hash);
      await connect.until(CONNECTED, TIMEOUT_MS);
      await connect.until(`${text('#topbar h1')} === ${JSON.stringify(title)}`, TIMEOUT_MS);

      await connect.evaluate('window.__fake.channel.close()');
      await connect.until(
        `${text('#link-banner strong')} === 'Waiting for your phone'`,
        TIMEOUT_MS
      );
      expect(await connect.evaluate(text('#topbar h1'))).toBe(title);
      expect(await connect.evaluate(`document.querySelector('#rail') !== null`)).toBe(true);
      expect(
        await connect.evaluate(
          `document.querySelector('.page-body')?.hasAttribute('inert') === true`
        )
      ).toBe(true);

      await connect.until(CONNECTED, TIMEOUT_MS);
      expect(await connect.evaluate(`document.getElementById('link-banner')`)).toBeNull();
      expect(
        await connect.evaluate(
          `document.querySelector('.page-body')?.hasAttribute('inert') === true`
        )
      ).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    'keeps the routes rows dimmed under the banner through a drop, and live again when the phone answers',
    async () => {
      const connect = await visit(await phoneScript('demo'), '#/routes');
      await connect.until(CONNECTED, TIMEOUT_MS);
      await connect.until(ROUTE_ROWS, TIMEOUT_MS);

      await connect.evaluate('window.__fake.channel.close()');
      await connect.until(WAITING, TIMEOUT_MS);
      expect(await connect.evaluate(ROUTE_ROWS)).toBe(true);
      expect(await connect.evaluate(`document.querySelector('#link-banner') !== null`)).toBe(true);
      expect(
        await connect.evaluate(
          `document.querySelector('.page-body')?.hasAttribute('inert') === true`
        )
      ).toBe(true);

      await connect.until(CONNECTED, TIMEOUT_MS);
      await connect.until(ROUTE_ROWS, TIMEOUT_MS);
      expect(
        await connect.evaluate(
          `document.querySelector('.page-body')?.hasAttribute('inert') === true`
        )
      ).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    'clears the routes rows and shows the waiting pane when the athlete disconnects on the phone',
    async () => {
      const connect = await visit(await phoneScript('demo'), '#/routes');
      await connect.until(CONNECTED, TIMEOUT_MS);
      await connect.until(ROUTE_ROWS, TIMEOUT_MS);

      await connect.evaluate(`(() => {
        const body = new TextEncoder().encode(JSON.stringify({ event: 'farewell', reason: 'disconnected' }));
        const frame = new Uint8Array(10 + body.length);
        new DataView(frame.buffer).setUint8(0, 1);
        frame[1] = 2;
        frame.set(body, 10);
        window.__fake.channel.onmessage({ data: frame.buffer });
      })()`);
      await connect.until(`document.querySelector('#link-banner') !== null`, TIMEOUT_MS);
      expect(await connect.evaluate(text('#link-banner span'))).toBe(
        enGB.connectPage.waiting.disconnected
      );
      expect(await connect.evaluate(`document.querySelector('#routes-page') === null`)).toBe(true);
      expect(await connect.evaluate(`document.querySelector('.page-body') === null`)).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    'tries the phone at once when the athlete presses retry in the banner',
    async () => {
      const connect = await visit(await phoneScript('demo'));
      await connect.until(CONNECTED, TIMEOUT_MS);
      await connect.evaluate('window.__fake.channel.close()');
      await connect.until(`document.querySelector('#link-retry') !== null`, TIMEOUT_MS);

      await connect.evaluate(`document.getElementById('link-retry').click()`);
      await connect.until(CONNECTED, LINK_MS);
    },
    TIMEOUT_MS
  );

  it(
    'shows the update panel with retry, and offers retry and unlink in the account menu',
    async () => {
      const script = await phoneScript('demo');
      const outdated: Script = {
        ...script,
        methods: script.methods.filter((method) => method !== 'feed.page'),
      };
      const connect = await visit(outdated);
      await connect.until(`document.querySelector('#update h2') !== null`, TIMEOUT_MS);
      expect(await connect.evaluate(text('#update h2'))).toBe('Update Veloq on your phone');
      expect(
        await connect.evaluate(`document.querySelector('#update #update-retry') !== null`)
      ).toBe(true);
      expect(await connect.evaluate(`document.getElementById('rail')`)).toBeNull();

      await connect.evaluate(`document.getElementById('account-button').click()`);
      await connect.until(`document.getElementById('account-menu') !== null`);
      expect(
        await connect.evaluate(`document.querySelector('#account-menu #retry') !== null`)
      ).toBe(true);
      expect(
        await connect.evaluate(`document.querySelector('#account-menu #forget') !== null`)
      ).toBe(true);
    },
    TIMEOUT_MS
  );
});
