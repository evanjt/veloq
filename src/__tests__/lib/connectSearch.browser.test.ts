/**
 * Scenario: the connect page is opened on the scripted demo phone at 1920 by
 * 1080 and sent to every kind of page by its hash.
 *
 * Expected behaviour: on every page the top bar holds exactly one search
 * control, enabled, between 280 and 360 px wide and sitting beside the link
 * chip at the right of the bar; Ctrl+K and `/` each open the palette; with
 * nothing typed it lists Recent items once one has been opened, then Pages and
 * Actions; and the `?` key opens the shortcut help as a dialog.
 *
 * Runs with `npm run test:map-pages`, which needs a Chromium.
 */

import { normaliseFingerprint, proof } from '../../../web/connect/link';
import type { PageKey } from '../../../web/connect/pages';
import { SHOWN_ACTIVITY, demoScript } from '../__shared__/connectDemoLibrary';
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

/** One address for every page key. */
const ADDRESSES: Record<PageKey, string> = {
  feed: '#/activities',
  activity: `#/activity/${SHOWN_ACTIVITY}`,
  map: '#/map',
  routes: '#/routes',
  sections: '#/sections',
  fitness: '#/fitness',
  insights: '#/insights',
  strength: '#/strength',
  exercise: '#/exercise/1',
  workouts: '#/workouts',
  live: '#/live',
  recordings: '#/recordings',
  recording: '#/recording/none',
  settings: '#/settings',
  later: '#/best-efforts',
};

const press = (init: string, target = 'document.body') =>
  `${target}.dispatchEvent(new KeyboardEvent('keydown', { ${init}, bubbles: true }))`;
const PALETTE_OPEN = `document.querySelector('.ui-dialog-backdrop #palette-input') !== null`;
const closePalette = `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`;

const chromium = findChromium();
const describeWithChromium = chromium ? describe : describe.skip;

describeWithChromium('the connect page search in a headless Chromium', () => {
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

  it.each(Object.entries(ADDRESSES))(
    'holds one enabled search that Ctrl+K and / open, on the %s page',
    async (_key, address) => {
      await connect.evaluate(`location.hash = ${JSON.stringify(address)}`);
      await connect.until(`document.querySelector('#content .page-body') !== null`);

      expect(
        await connect.evaluate(`(() => {
          const bar = document.querySelector('#topbar');
          const fields = bar.querySelectorAll('#topbar-search');
          const search = fields[0];
          return {
            count: fields.length,
            controls: bar.querySelectorAll('[id^="topbar-search"], #topbar-palette').length,
            disabled: search.disabled,
          };
        })()`)
      ).toEqual({ count: 1, controls: 1, disabled: false });

      await connect.evaluate(press(`key: 'k', ctrlKey: true`));
      await connect.until(PALETTE_OPEN);
      await connect.evaluate(closePalette);
      await connect.until(`!(${PALETTE_OPEN})`);

      await connect.evaluate(press(`key: '/'`));
      await connect.until(PALETTE_OPEN);
      await connect.evaluate(closePalette);
      await connect.until(`!(${PALETTE_OPEN})`);
    },
    TIMEOUT_MS
  );

  it(
    'sits at the right of the bar beside the link chip, 280 to 360 px wide',
    async () => {
      const box = await connect.evaluate<{ width: number; gap: number }>(`(() => {
        const search = document.querySelector('#topbar-search').getBoundingClientRect();
        const chip = document.querySelector('#topbar .connection').getBoundingClientRect();
        return { width: search.width, gap: chip.left - search.right };
      })()`);
      expect(box.width).toBeGreaterThanOrEqual(280);
      expect(box.width).toBeLessThanOrEqual(360);
      expect(box.gap).toBeGreaterThanOrEqual(0);
      expect(box.gap).toBeLessThanOrEqual(16);
    },
    TIMEOUT_MS
  );

  it(
    'lists pages and actions when empty, then the item opened last under Recent',
    async () => {
      await connect.evaluate(`location.hash = '#/activities'`);
      await connect.until(`document.querySelector('#content .page-body') !== null`);
      await connect.evaluate(press(`key: 'k', ctrlKey: true`));
      await connect.until(PALETTE_OPEN);
      expect(
        await connect.evaluate(
          `[...document.querySelectorAll('.palette-heading')].map((li) => li.dataset.group)`
        )
      ).toEqual(['page', 'action']);

      await connect.evaluate(
        `[...document.querySelectorAll('.palette-list [role=option]')].find((li) => li.textContent === 'Routes').click()`
      );
      await connect.until(`location.hash.startsWith('#/routes')`);
      await connect.until(`!(${PALETTE_OPEN})`);
      expect(
        await connect.evaluate(`JSON.parse(localStorage.getItem('veloq-connect-recent') ?? '[]')`)
      ).toEqual([]);
    },
    TIMEOUT_MS
  );

  it(
    'opens the keyboard help as a dialog that names every page digit and chord',
    async () => {
      await connect.evaluate(press(`key: '?'`));
      await connect.until(`document.querySelector('.ui-dialog #keys') !== null`);
      expect(
        await connect.evaluate(
          `[...document.querySelectorAll('#keys-pages .key-row')].map((row) => row.textContent)`
        )
      ).toHaveLength(10);
    },
    TIMEOUT_MS
  );

  it(
    'ignores single keys once they are turned off, and keeps Ctrl+K',
    async () => {
      await connect.evaluate(`localStorage.setItem('veloq-connect-shortcuts', 'off')`);
      await connect.evaluate(`location.reload()`);
      await connect.until(CONNECTED, TIMEOUT_MS);
      await connect.evaluate(press(`key: '/'`));
      await connect.evaluate(press(`key: '?'`));
      await new Promise((done) => setTimeout(done, 300));
      expect(await connect.evaluate(PALETTE_OPEN)).toBe(false);
      expect(await connect.evaluate(`document.querySelector('.ui-dialog #keys') !== null`)).toBe(
        false
      );
      await connect.evaluate(press(`key: 'k', ctrlKey: true`));
      await connect.until(PALETTE_OPEN);
    },
    TIMEOUT_MS
  );
});
