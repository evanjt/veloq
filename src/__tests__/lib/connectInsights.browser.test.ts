/**
 * Scenario: the connect page is opened on the scripted demo phone and sent to
 * the insights page, in a 1600 by 1000 window.
 *
 * Expected behaviour: the page draws a grid of insight cards grouped by
 * category, a strip for today and the planned events of the coming fortnight.
 * Opening a card shows a drawer beside the grid with its history chart and
 * method, and the address keeps the choice. The fitness page no longer carries
 * the insight cards.
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

const TIMEOUT_MS = 60_000;

const BROWSER = normaliseFingerprint('sha-256', 'AA:11:22:33');
const PHONE = normaliseFingerprint('sha-256', 'BB:44:55:66');
const SECRET = new Uint8Array(32).fill(2);

const CONNECTED = `document.querySelector('#status[data-state="connected"]') !== null`;
const count = (selector: string) => `document.querySelectorAll(${JSON.stringify(selector)}).length`;

const chromium = findChromium();
const describeWithChromium = chromium ? describe : describe.skip;

describeWithChromium('the connect insights page in a headless Chromium', () => {
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
      { width: 1600, height: 1000 }
    );
    await connect.until(CONNECTED, TIMEOUT_MS);
  }, TIMEOUT_MS);

  afterEach(async () => {
    expect(connect.errors()).toEqual([]);
    await browser.close();
  });

  it(
    'draws grouped cards, today and the planned events, and opens a card in a drawer with its chart',
    async () => {
      await connect.evaluate(`location.hash = '#/insights'`);
      await connect.until(`${count('#insight-cards article')} > 0`, TIMEOUT_MS);
      expect(await connect.evaluate(count('#insight-cards [data-group]'))).toBeGreaterThan(0);
      expect(await connect.evaluate(`document.getElementById('insights-today') !== null`)).toBe(
        true
      );
      await connect.until(`${count('#planned-events tbody tr')} > 0`, TIMEOUT_MS);
      expect(await connect.evaluate(`document.getElementById('insight-drawer') === null`)).toBe(
        true
      );

      await connect.evaluate(
        `document.querySelector('#insight-cards article[data-history] button[data-action=open]')?.click()`
      );
      await connect.until(`document.querySelector('#insight-drawer svg') !== null`);
      expect(await connect.evaluate(`location.hash.includes('card=')`)).toBe(true);
      expect(
        await connect.evaluate(
          `document.querySelector('#insight-drawer details, #insight-drawer .method') !== null`
        )
      ).toBe(true);

      await connect.evaluate(
        `document.querySelector('#insight-drawer button[data-action=close]')?.click()`
      );
      await connect.until(`document.getElementById('insight-drawer') === null`);
      expect(await connect.evaluate(`location.hash.includes('card=')`)).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    'keeps the insight cards off the fitness page',
    async () => {
      await connect.evaluate(`location.hash = '#/fitness'`);
      await connect.until(`document.getElementById('fitness-page') !== null`, TIMEOUT_MS);
      expect(await connect.evaluate(`document.getElementById('insight-cards') === null`)).toBe(
        true
      );
    },
    TIMEOUT_MS
  );
});
