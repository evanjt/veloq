/**
 * Scenario: the connect page is opened on the scripted demo phone, which holds sections awaiting
 * review and keeps the workouts the page saves.
 *
 * Expected behaviour: the sections page's primary button names the sections awaiting review and is
 * enabled, and a section awaiting review is listed. On the workouts page a blank workout takes the
 * first exercise of the picker and is saved; the page then opens the saved workout with that
 * exercise, and no read fails.
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

const chromium = findChromium();
const describeWithChromium = chromium ? describe : describe.skip;

describeWithChromium('the demo phone’s review queue and saved workouts', () => {
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
      { width: 1440, height: 900 }
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
    'offers to accept the sections awaiting review, and lists one of them',
    async () => {
      await open(
        '#/sections',
        `document.querySelector('#sections-list tbody tr[data-row="section-5"]') !== null`
      );
      const primary = await connect.evaluate<{ text: string; disabled: boolean } | null>(`(() => {
        const button = [...document.querySelectorAll('.filter-bar button')].find((b) => /to review/.test(b.textContent));
        return button ? { text: button.textContent, disabled: button.disabled } : null;
      })()`);
      expect(primary?.disabled).toBe(false);
      expect(Number(/\((\d+) to review\)/.exec(primary?.text ?? '')?.[1])).toBeGreaterThan(0);
    },
    TIMEOUT_MS
  );

  it(
    'saves a blank workout with its first picker exercise, and opens it back with that exercise',
    async () => {
      await open('#/workouts', `document.querySelector('#workout-picker tbody tr') !== null`);
      await connect.evaluate(`document.querySelector('#workout-picker tbody tr').click()`);
      await connect.until(
        `document.querySelectorAll('#workout-exercises li').length === 1`,
        TIMEOUT_MS
      );
      await connect.evaluate(`(() => {
        const input = document.getElementById('workout-name');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Mobility');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await connect.evaluate(
        `[...document.querySelectorAll('button')].find((b) => b.textContent === 'Save workout' && !b.disabled).click()`
      );
      await connect.until(`location.hash === '#/workout/workout-4'`, TIMEOUT_MS);
      await connect.until(
        `document.querySelectorAll('#workout-exercises li').length === 1`,
        TIMEOUT_MS
      );
      expect(
        await connect.evaluate<number>(`document.querySelectorAll('[data-read-error]').length`)
      ).toBe(0);
    },
    TIMEOUT_MS
  );
});
