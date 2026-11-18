/**
 * Scenario: the connect page is opened on the scripted demo phone at 1920 by 1080, sent to the
 * activities list, and the command palette is opened with Ctrl+K.
 *
 * Expected behaviour: the dialog's backdrop paints over the list's sticky table header, so the
 * element at the header's centre is the backdrop or something inside it, not the header.
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
const VIEWPORT = { width: 1920, height: 1080 };

/** Whether the element painted at the centre of the first table header is in the header or in a dialog backdrop. */
const PAINTED_AT_HEADER = `(() => {
  const th = document.querySelector('.ui-table th');
  const box = th.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return {
    inHeader: hit.closest('th') !== null,
    inBackdrop: hit.closest('.ui-dialog-backdrop') !== null,
  };
})()`;

const chromium = findChromium();
const describeWithChromium = chromium ? describe : describe.skip;

describeWithChromium('the connect page paint order in a headless Chromium', () => {
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
      VIEWPORT
    );
    await connect.until(CONNECTED, TIMEOUT_MS);
  }, TIMEOUT_MS);

  afterEach(async () => {
    expect(connect.errors()).toEqual([]);
    await browser.close();
  });

  it(
    'paints the dialog backdrop over the sticky table header',
    async () => {
      await connect.evaluate(`location.hash = '#/activities'`);
      await connect.until(`document.querySelectorAll('.ui-table th').length > 0`);
      expect(await connect.evaluate(PAINTED_AT_HEADER)).toEqual({
        inHeader: true,
        inBackdrop: false,
      });

      await connect.evaluate(
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`
      );
      await connect.until(`document.querySelector('.ui-dialog-backdrop') !== null`);

      expect(await connect.evaluate(PAINTED_AT_HEADER)).toEqual({
        inHeader: false,
        inBackdrop: true,
      });
    },
    TIMEOUT_MS
  );
});
