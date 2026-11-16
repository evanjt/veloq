/**
 * Scenario: the connect page is opened on the scripted demo phone and sent to
 * a page by its hash, in a 1440 by 900 window.
 *
 * Expected behaviour: the top bar is 48 px and names the screen on view with a
 * breadcrumb, not the tab it sits under: an activity shows its own name under
 * Activities, the routes list shows Routes, the live session sits under Strength. The sidebar is 232 px with Training,
 * Analysis and Library groups, collapses to 56 px, and keeps that choice in the
 * browser. The language, the linked phone and unlink live in the account menu,
 * and no page has a footer. Exactly one element scrolls, the content pane, on
 * every page that is a long list or a long page.
 *
 * Runs with `npm run test:map-pages`, which needs a Chromium.
 */

import { normaliseFingerprint, proof } from '../../../web/connect/link';
import { SHOWN_ACTIVITY, ACTIVITIES, demoScript } from '../__shared__/connectDemoLibrary';
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
const VIEWPORT = { width: 1440, height: 900 };

const text = (selector: string) =>
  `(document.querySelector(${JSON.stringify(selector)})?.textContent ?? null)`;

/** Every element that scrolls vertically, named by id or tag, and whether the document scrolls. */
const SCROLLERS = `(() => {
  const named = [];
  for (const el of document.querySelectorAll('body *')) {
    const overflow = getComputedStyle(el).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
      named.push(el.id || el.tagName.toLowerCase());
    }
  }
  const root = document.scrollingElement;
  if (root.scrollHeight > root.clientHeight + 1) named.push('document');
  return named;
})()`;

const chromium = findChromium();
const describeWithChromium = chromium ? describe : describe.skip;

describeWithChromium('the connect page shell in a headless Chromium', () => {
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
    'names an activity by its own name under Activities, and each other page by its own title',
    async () => {
      const shown = ACTIVITIES.find((each) => each.id === SHOWN_ACTIVITY);
      await connect.evaluate(`location.hash = '#/activity/${SHOWN_ACTIVITY}'`);
      await connect.until(`${text('#topbar h1')} === ${JSON.stringify(shown?.name)}`);
      expect(await connect.evaluate(text('#breadcrumb li:first-child'))).toBe('Activities');
      expect(
        await connect.evaluate(`document.querySelector('#breadcrumb li:first-child a')?.hash`)
      ).toBe('#/activities');

      await connect.evaluate(`location.hash = '#/routes'`);
      await connect.until(`${text('#topbar h1')} === 'Routes'`);
      expect(await connect.evaluate(`document.getElementById('breadcrumb') === null`)).toBe(true);

      await connect.evaluate(`location.hash = '#/live'`);
      await connect.until(`${text('#topbar h1')} === 'Live session'`);
      expect(await connect.evaluate(text('#breadcrumb li:first-child'))).toBe('Strength');

      await connect.evaluate(`location.hash = '#/workouts'`);
      await connect.until(`${text('#topbar h1')} === 'Workouts'`);
      await connect.evaluate(`location.hash = '#/recordings'`);
      await connect.until(`${text('#topbar h1')} === 'Recordings'`);
      await connect.evaluate(`location.hash = '#/insights'`);
      await connect.until(`${text('#topbar h1')} === 'Insights'`);
    },
    TIMEOUT_MS
  );

  it(
    'draws each screen title once, in the top bar, and no heading in the content repeats it',
    async () => {
      const headings = `[...document.querySelectorAll('#content h1, #content h2')].map((h) => h.textContent)`;
      const screens: [hash: string, title: string][] = [
        ['#/activities', 'Activities'],
        ['#/routes', 'Routes'],
        ['#/fitness', 'Fitness'],
        ['#/insights', 'Insights'],
        ['#/insights?type=strength', 'Strength'],
        ['#/live', 'Live session'],
        ['#/workouts', 'Workouts'],
        ['#/recordings', 'Recordings'],
        ['#/settings', 'Settings'],
      ];
      for (const [hash, title] of screens) {
        await connect.evaluate(`location.hash = '${hash}'`);
        await connect.until(`${text('#topbar h1')} === ${JSON.stringify(title)}`);
        expect(await connect.evaluate<string[]>(headings)).not.toContain(title);
      }

      const shown = ACTIVITIES.find((each) => each.id === SHOWN_ACTIVITY);
      await connect.evaluate(`location.hash = '#/activity/${SHOWN_ACTIVITY}'`);
      await connect.until(`${text('#topbar h1')} === ${JSON.stringify(shown?.name)}`);
      expect(await connect.evaluate<string[]>(headings)).not.toContain(shown?.name);
    },
    TIMEOUT_MS
  );

  it(
    'has one scrolling element, the content pane, on a long list and on a long page',
    async () => {
      await connect.evaluate(`location.hash = '#/activities'`);
      await connect.until(`document.querySelectorAll('#feed-scroll tbody tr').length > 20`);
      expect(await connect.evaluate(SCROLLERS)).toEqual(['content']);

      await connect.evaluate(`location.hash = '#/fitness'`);
      await connect.until(`document.querySelector('#months tbody tr') !== null`);
      expect(await connect.evaluate(SCROLLERS)).toEqual(['content']);
    },
    TIMEOUT_MS
  );

  it(
    'pins the table header to the top of the scrolling pane after a scroll, on the feed and in the map list',
    async () => {
      const PINNED = (scroller: string) => `(() => {
        const pane = document.querySelector(${JSON.stringify(scroller)});
        pane.scrollTop = 600;
        const th = pane.querySelector('thead th');
        return { scrolled: pane.scrollTop, th: th.getBoundingClientRect().top, pane: pane.getBoundingClientRect().top + pane.clientTop };
      })()`;
      type Pinned = { scrolled: number; th: number; pane: number };

      await connect.evaluate(`location.hash = '#/activities'`);
      await connect.until(`document.querySelectorAll('#feed-scroll tbody tr').length > 20`);
      const feed = await connect.evaluate<Pinned>(PINNED('#content'));
      expect(feed.scrolled).toBeGreaterThan(0);
      expect(feed.th).toBeCloseTo(feed.pane, 0);

      await connect.evaluate(`location.hash = '#/map'`);
      await connect.until(`document.querySelector('#map-list thead th') !== null`);
      const side = await connect.evaluate<Pinned>(`(() => {
        const pane = document.querySelector('.map-list-table');
        const spacer = document.createElement('div');
        spacer.style.height = '2000px';
        pane.append(spacer);
        return 0;
      })()`);
      expect(side).toBe(0);
      const map = await connect.evaluate<Pinned>(PINNED('.map-list-table'));
      expect(map.scrolled).toBeGreaterThan(0);
      expect(map.th).toBeCloseTo(map.pane, 0);
    },
    TIMEOUT_MS
  );

  it(
    'draws a 48 px top bar over a 232 px sidebar of three groups that collapses to 56 px and stays so',
    async () => {
      const box = (selector: string) =>
        connect.evaluate<{ width: number; height: number }>(
          `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { width: r.width, height: r.height }; })()`
        );
      expect((await box('#topbar')).height).toBe(48);
      expect((await box('#rail')).width).toBe(232);
      expect(
        await connect.evaluate<string[]>(
          `[...document.querySelectorAll('#rail .group-title')].map((h) => h.textContent)`
        )
      ).toEqual(['Training', 'Analysis', 'Library']);
      expect(
        await connect.evaluate<string[]>(
          `[...document.querySelectorAll('#rail a')].map((a) => a.textContent)`
        )
      ).toEqual([
        'Activities',
        'Map',
        'Routes',
        'Sections',
        'Fitness',
        'Insights',
        'Strength',
        'Workouts',
        'Recordings',
        'Settings',
      ]);

      await connect.evaluate(`document.getElementById('sidebar-toggle').click()`);
      await connect.until(`document.querySelector('#rail').getBoundingClientRect().width === 56`);
      expect(await connect.evaluate(`localStorage.getItem('veloq-connect-sidebar')`)).toBe(
        'collapsed'
      );
      expect(
        await connect.evaluate(
          `document.getElementById('sidebar-toggle').getAttribute('aria-expanded')`
        )
      ).toBe('false');
    },
    TIMEOUT_MS
  );

  it(
    'holds the language, the linked phone and unlink in the account menu and has no footer',
    async () => {
      const present = (selector: string) =>
        connect.evaluate<boolean>(`document.querySelector(${JSON.stringify(selector)}) !== null`);
      expect(await present('footer')).toBe(false);
      expect(await present('#forget')).toBe(false);
      expect(await present('#topbar #language')).toBe(false);

      await connect.evaluate(`document.getElementById('account-button').click()`);
      await connect.until(`document.getElementById('account-menu') !== null`);
      expect(await connect.evaluate(text('#account-phone'))).toBe('Sam’s phone');
      expect(await present('#account-menu #language')).toBe(true);
      expect(await present('#account-menu #forget')).toBe(true);
      await connect.evaluate(
        `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`
      );
      await connect.until(`document.getElementById('account-menu') === null`);
    },
    TIMEOUT_MS
  );
});

describeWithChromium('data table cells on a desktop window of 1280 by 800', () => {
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
      { width: 1280, height: 800 }
    );
    await connect.until(CONNECTED, TIMEOUT_MS);
  }, TIMEOUT_MS);

  afterEach(async () => {
    expect(connect.errors()).toEqual([]);
    await browser.close();
  });

  it(
    'keeps every cell of the map list on one line at 32 px a row, with no wrapped date, time or number',
    async () => {
      await connect.evaluate(`location.hash = '#/map'`);
      await connect.until(`document.querySelectorAll('#map-list tbody tr').length > 0`);
      const LINES_PER_CELL = `[...document.querySelectorAll('#map-list tbody td')]
        .map((cell) => {
          const range = document.createRange();
          range.selectNodeContents(cell);
          return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
        })
        .filter((lines) => lines > 1)`;
      expect(await connect.evaluate(LINES_PER_CELL)).toEqual([]);
      expect(
        await connect.evaluate<number>(
          `document.querySelector('#map-list tbody tr').getBoundingClientRect().height`
        )
      ).toBe(32);
    },
    TIMEOUT_MS
  );
});
