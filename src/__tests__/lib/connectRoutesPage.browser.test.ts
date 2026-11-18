/**
 * Scenario: the routes pages are opened on the scripted demo phone in a 1280 by 800 window and in
 * a 1600 by 1000 one.
 *
 * Expected behaviour: the list and the map are side by side and their boxes do not meet; the map
 * stays inside the window however long the list or the attempts table is, and a route's map draws
 * above the fold; a route's detail opens beside the map with three views of its attempts and a
 * table whose rows stay on one line; excluding two attempts from the table sends two writes and
 * shows one toast with an undo; nothing is logged as an error.
 *
 * Runs with `npm run test:map-pages`, which needs a Chromium.
 */

import { normaliseFingerprint, proof } from '../../../web/connect/link';
import { demoScript } from '../__shared__/connectDemoLibrary';
import {
  buildPage,
  findChromium,
  launchConnectBrowser,
  type ConnectBrowser,
  type ConnectPage,
} from '../__shared__/headlessConnectPage';

const TIMEOUT_MS = 90_000;

const BROWSER = normaliseFingerprint('sha-256', 'AA:11:22:33');
const PHONE = normaliseFingerprint('sha-256', 'BB:44:55:66');
const SECRET = new Uint8Array(32).fill(2);

const CONNECTED = `document.querySelector('#status[data-state="connected"]') !== null`;

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

const boxOf = (selector: string) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
})()`;

const apart = (a: Box, b: Box) =>
  a.right <= b.left + 0.5 ||
  b.right <= a.left + 0.5 ||
  a.bottom <= b.top + 0.5 ||
  b.bottom <= a.top + 0.5;

const SIZES = [
  { width: 1280, height: 800 },
  { width: 1600, height: 1000 },
];

const chromium = findChromium();
const describeWithChromium = chromium ? describe : describe.skip;

describeWithChromium.each(SIZES)('the routes pages at $width by $height', (size) => {
  let page: { dir: string; remove: () => void };
  let browser: ConnectBrowser;
  let connect: ConnectPage;

  beforeAll(() => {
    page = buildPage();
  }, TIMEOUT_MS);

  afterAll(() => page.remove());

  beforeEach(async () => {
    browser = await launchConnectBrowser(chromium as string, page.dir);
    connect = await browser.open(
      demoScript({
        browserFingerprint: BROWSER,
        phoneFingerprint: PHONE,
        phoneProof: await proof(SECRET, 'phone', BROWSER, PHONE),
      }),
      undefined,
      size
    );
    await connect.until(CONNECTED, TIMEOUT_MS);
  }, TIMEOUT_MS);

  afterEach(async () => {
    expect(connect.errors()).toEqual([]);
    await browser.close();
  });

  const open = async (hash: string, ready: string) => {
    await connect.evaluate(`location.hash = ${JSON.stringify(hash)}`);
    await connect.until(ready, TIMEOUT_MS);
  };

  it(
    'draws the list and the map side by side inside the window',
    async () => {
      await open('#/routes', `document.querySelector('#routes-list tbody tr') !== null`);
      const list = await connect.evaluate<Box>(boxOf('#routes-list'));
      const map = await connect.evaluate<Box>(boxOf('#map-slot'));
      expect(apart(list, map)).toBe(true);
      expect(map.top).toBeGreaterThanOrEqual(0);
      expect(map.bottom).toBeLessThanOrEqual(size.height);
      expect(map.height).toBeGreaterThanOrEqual(360);
      expect(map.right).toBeLessThanOrEqual(size.width);
      // Nothing else is drawn in the page body: the map has the room right of the list.
      expect(map.width).toBeGreaterThan(list.width);
    },
    TIMEOUT_MS
  );

  it(
    'opens a route beside its map, with three views and an attempts table whose rows stay on one line',
    async () => {
      await open(
        '#/route/route-0',
        `document.querySelector('#routes-detail [role="tab"]') !== null`
      );
      const map = await connect.evaluate<Box>(boxOf('#map-slot'));
      const detail = await connect.evaluate<Box>(boxOf('#routes-detail'));
      expect(apart(map, detail)).toBe(true);
      const list = await connect.evaluate<Box | null>(boxOf('#routes-list'));
      if (list && list.width > 0) {
        expect(apart(list, map)).toBe(true);
        expect(apart(list, detail)).toBe(true);
      }
      expect(map.top).toBeGreaterThanOrEqual(0);
      expect(map.bottom).toBeLessThanOrEqual(size.height);
      expect(detail.width).toBeGreaterThanOrEqual(420);

      const tabs = await connect.evaluate<string[]>(
        `[...document.querySelectorAll('#routes-detail [role="tab"]')].map((tab) => tab.textContent)`
      );
      expect(tabs).toEqual(['Over time', 'Spread', 'Ahead or behind']);

      await connect.until(
        `document.querySelectorAll('#route-attempts tbody tr[data-row]').length > 3`
      );
      const rows = await connect.evaluate<number[]>(
        `[...document.querySelectorAll('#route-attempts tbody tr[data-row]')].slice(0, 12).map((tr) => tr.getBoundingClientRect().height)`
      );
      expect(Math.max(...rows)).toBeLessThanOrEqual(40);
      const clipped = await connect.evaluate<number>(
        `document.querySelector('#route-attempts').closest('.ui-table-scroll').scrollWidth - document.querySelector('#route-attempts').closest('.ui-table-scroll').clientWidth`
      );
      expect(clipped).toBeLessThanOrEqual(1);
      const [tableWidth, paneWidth] = await connect.evaluate<number[]>(`(() => {
        const host = document.querySelector('#route-attempts').closest('.ui-context-wrap').parentElement;
        const style = getComputedStyle(host);
        return [
          document.querySelector('#route-attempts').getBoundingClientRect().width,
          host.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        ];
      })()`);
      expect(tableWidth).toBeGreaterThanOrEqual(paneWidth - 1);

      await connect.evaluate(
        `document.querySelector('#routes-detail [role="tab"]:nth-child(2)').click()`
      );
      await connect.until(
        `document.querySelector('#routes-detail figure.chart .mark-bar') !== null`
      );
      await connect.evaluate(
        `document.querySelector('#routes-detail [role="tab"]:nth-child(3)').click()`
      );
      await connect.until(
        `document.querySelector('#routes-detail figure.chart .mark-line') !== null`
      );
    },
    TIMEOUT_MS
  );

  it(
    'sends two writes and shows one undo toast when two attempts are excluded from the table',
    async () => {
      await open(
        '#/route/route-0',
        `document.querySelectorAll('#route-attempts tbody tr[data-row]').length > 3`
      );
      const click = (at: number, ctrlKey: boolean) =>
        connect.evaluate(
          `document.querySelectorAll('#route-attempts tbody tr[data-row]')[${at}].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: ${ctrlKey} }))`
        );
      await click(0, false);
      await connect.until(
        `document.querySelectorAll('#route-attempts tr[aria-selected="true"]').length === 1`
      );
      await click(1, true);
      await connect.until(
        `document.querySelectorAll('#route-attempts tr[aria-selected="true"]').length === 2`
      );
      await connect.evaluate(
        `[...document.querySelectorAll('.ui-table-bulk button')].find((b) => b.textContent === 'Exclude selected').click()`
      );
      await connect.until(`document.querySelectorAll('.ui-toast').length === 1`);
      const writes = await connect.evaluate<number>(
        `window.__fake.channel.sent.filter((ask) => ask.method === 'route.excludeActivity').length`
      );
      expect(writes).toBe(2);
      expect(await connect.evaluate<number>(`document.querySelectorAll('.ui-toast').length`)).toBe(
        1
      );
      expect(
        await connect.evaluate<boolean>(
          `[...document.querySelectorAll('.ui-toast button')].some((b) => b.textContent === 'Undo')`
        )
      ).toBe(true);
    },
    TIMEOUT_MS
  );
});
