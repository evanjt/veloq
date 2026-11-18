/**
 * Scenario: the athlete narrows a list by typing into the filter in its table's toolbar, on the
 * activities, routes, sections, workouts and recordings pages, with the scripted phone narrowing
 * as the engine does.
 *
 * Expected behaviour: typing lowers the rows, the count beside the field reads "N of M" for the
 * rows left of the rows held, the text is written to the address as `q=`, a reload from that
 * address restores the text, the count and the rows, and the clear button restores them all and
 * removes `q=`. Nothing is logged as an error.
 *
 * Runs with `npm run test:map-pages`, which needs a Chromium.
 */

import { normaliseFingerprint, proof } from '../../../web/connect/link';
import { ROUTE_NAMES, SECTION_NAMES } from '../__shared__/connectDemoBase';
import { ACTIVITIES, demoResults, demoScript } from '../__shared__/connectDemoLibrary';
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

const results = demoResults();

/** A word of an activity's name that some of the activities hold and not all. */
function activityWord(): { word: string; matching: number } {
  const held = (word: string) =>
    ACTIVITIES.filter(
      (a) => a.name.toLowerCase().includes(word) || a.sport.type.toLowerCase().includes(word)
    ).length;
  for (const activity of ACTIVITIES) {
    for (const word of activity.name.toLowerCase().split(/\s+/)) {
      const matching = held(word);
      if (word.length >= 4 && matching > 0 && matching < ACTIVITIES.length) {
        return { word, matching };
      }
    }
  }
  throw new Error('no word narrows the demo activities');
}

const named = (names: readonly string[], text: string) =>
  names.filter((name) => name.toLowerCase().includes(text)).length;

type Case = {
  page: string;
  hash: string;
  rows: string;
  text: string;
  matching: number;
  total: number;
};

const activities = activityWord();
const recordings = results['recordings.list'].recordings;
const exercises = results['strength.picker'].rows;

const CASES: Case[] = [
  {
    page: 'activities',
    hash: '#/activities',
    rows: '#feed-scroll tbody tr[data-row]',
    text: activities.word,
    matching: activities.matching,
    total: ACTIVITIES.length,
  },
  {
    page: 'routes',
    hash: '#/routes',
    rows: '#routes-list tbody tr[data-row]',
    text: 'lake',
    matching: named(ROUTE_NAMES, 'lake'),
    total: ROUTE_NAMES.length,
  },
  {
    page: 'sections',
    hash: '#/sections',
    rows: '#sections-list tbody tr[data-row]',
    text: 'lake',
    matching: named(SECTION_NAMES, 'lake'),
    total: SECTION_NAMES.length,
  },
  {
    page: 'workouts',
    hash: '#/workouts',
    rows: '.workouts-picker tbody tr[data-row]',
    text: 'press',
    matching: named(
      exercises.map((row) => row.displayName),
      'press'
    ),
    total: exercises.length,
  },
  {
    page: 'recordings',
    hash: '#/recordings',
    rows: '#recordings-list tbody tr[data-row]',
    text: 'easy',
    matching: named(
      recordings.map((row) => row.name),
      'easy'
    ),
    total: recordings.length,
  },
];

const chromium = findChromium();
const describeWithChromium = chromium ? describe : describe.skip;

const countText = `(document.querySelector('.ui-filter-count')?.textContent ?? null)`;
const rowCount = (selector: string) =>
  `document.querySelectorAll(${JSON.stringify(selector)}).length`;

const typeInto = (text: string) => `(() => {
  const input = document.querySelector('.ui-list-filter input');
  input.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`;

describeWithChromium('the filter in a list toolbar', () => {
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
      })
    );
    await connect.until(CONNECTED, TIMEOUT_MS);
  }, TIMEOUT_MS);

  afterEach(async () => {
    expect(connect.errors()).toEqual([]);
    await browser.close();
  });

  it.each(CASES)(
    'narrows the $page list, counts it, keeps its text in the address and restores it on reload',
    async ({ hash, rows, text, matching, total }) => {
      expect(matching).toBeGreaterThan(0);
      expect(matching).toBeLessThan(total);
      await connect.evaluate(`location.hash = ${JSON.stringify(hash)}`);
      await connect.until(`${countText} === ${JSON.stringify(`${total} of ${total}`)}`, TIMEOUT_MS);
      const held = await connect.evaluate<number>(rowCount(rows));
      expect(held).toBeGreaterThan(0);

      // The filter is a search landmark inside the table's own toolbar.
      expect(
        await connect.evaluate(
          `document.querySelector('.ui-table-bar [role="search"] input[type="search"]') !== null`
        )
      ).toBe(true);
      expect(
        await connect.evaluate(
          `document.querySelector('.ui-filter-count').getAttribute('aria-live')`
        )
      ).toBe('polite');

      await connect.evaluate(typeInto(text));
      const narrowed = `${matching} of ${total}`;
      await connect.until(`${countText} === ${JSON.stringify(narrowed)}`, TIMEOUT_MS);
      await connect.until(`location.hash.includes('q=${encodeURIComponent(text)}')`);
      const left = await connect.evaluate<number>(rowCount(rows));
      expect(left).toBeGreaterThan(0);
      expect(left).toBeLessThan(held);
      expect(left).toBeLessThanOrEqual(matching);
      // The field kept the keyboard through the read that followed the typing.
      expect(
        await connect.evaluate(`document.activeElement?.closest('[role="search"]') !== null`)
      ).toBe(true);

      await connect.evaluate(
        `window.__beforeReload = true; setTimeout(() => location.reload(), 0)`
      );
      await connect.until(
        `(() => { try { return window.__beforeReload === undefined && ${countText} === ${JSON.stringify(narrowed)}; } catch { return false; } })()`,
        TIMEOUT_MS
      );
      expect(await connect.evaluate(`document.querySelector('.ui-list-filter input').value`)).toBe(
        text
      );
      expect(await connect.evaluate<number>(rowCount(rows))).toBe(left);

      await connect.evaluate(`document.querySelector('.ui-list-filter button').click()`);
      await connect.until(`${countText} === ${JSON.stringify(`${total} of ${total}`)}`, TIMEOUT_MS);
      expect(await connect.evaluate<string>('location.hash')).not.toContain('q=');
      expect(await connect.evaluate<number>(rowCount(rows))).toBe(held);
    },
    TIMEOUT_MS
  );

  it(
    'keeps the field and its clear button when the text leaves no row',
    async () => {
      await connect.evaluate(`location.hash = '#/routes'`);
      await connect.until(
        `${countText} === '${ROUTE_NAMES.length} of ${ROUTE_NAMES.length}'`,
        TIMEOUT_MS
      );
      await connect.evaluate(typeInto('zzzz'));
      await connect.until(`${countText} === '0 of ${ROUTE_NAMES.length}'`, TIMEOUT_MS);
      expect(await connect.evaluate<number>(rowCount('#routes-list tbody tr[data-row]'))).toBe(0);
      expect(
        await connect.evaluate(`document.querySelector('.ui-list-filter button') !== null`)
      ).toBe(true);
    },
    TIMEOUT_MS
  );
});
