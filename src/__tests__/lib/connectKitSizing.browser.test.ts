/**
 * Scenario: the connect page is opened on the scripted demo phone in a 1600 by 1000 window, and
 * the fitness calendar and the feed are drawn.
 *
 * Expected behaviour: each year of the calendar is drawn at the width its cells give it, not
 * stretched to the width of its card, and the feed's summary tiles start at the top of the feed
 * rather than below a gap the page's own stylesheet adds.
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

const chromium = findChromium();
const describeWithChromium = chromium ? describe : describe.skip;

describeWithChromium('the connect page draws its kit at the sizes the kit gives it', () => {
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
    'draws every calendar year at the width of its drawing, not the width of its card',
    async () => {
      await connect.evaluate(`location.hash = '#/fitness?tab=calendar'`);
      await connect.until(
        `document.querySelectorAll('figure.calendar svg').length > 0`,
        TIMEOUT_MS
      );
      const widths = await connect.evaluate<{ rendered: number; drawn: number }[]>(
        `[...document.querySelectorAll('figure.calendar svg')].map((svg) => ({
          rendered: svg.getBoundingClientRect().width,
          drawn: Number(svg.getAttribute('width')),
        }))`
      );
      expect(widths.length).toBeGreaterThan(0);
      for (const { rendered, drawn } of widths) {
        expect(Math.abs(rendered - drawn)).toBeLessThanOrEqual(1);
      }
    },
    TIMEOUT_MS
  );

  it(
    'starts the feed summary tiles at the top of the feed',
    async () => {
      await connect.evaluate(`location.hash = '#/activities'`);
      await connect.until(`document.querySelector('#summary .ui-stat-label') !== null`, TIMEOUT_MS);
      const [summary, library] = await connect.evaluate<number[]>(
        `[document.getElementById('summary'), document.getElementById('library')].map(
          (el) => el.getBoundingClientRect().top
        )`
      );
      expect(summary - library).toBeLessThanOrEqual(1);
    },
    TIMEOUT_MS
  );
});
