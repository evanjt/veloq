/**
 * Scenario: the connect page is built as the deploy builds it and served on
 * the origin it is deployed on, with its content security policy. The relay
 * and the phone are scripts; IndexedDB is the browser's own.
 *
 * Expected behaviour: a browser with nothing kept shows the pairing pane and
 * draws a code onto the canvas. A phone that answers and proves itself takes
 * it through checking and confirming to connected, the feed shows the phone's
 * rows and a click on one shows its facts. A channel that closes returns the
 * page to waiting with an empty feed, and it connects again on its own. A
 * kept phone that answers with another fingerprint is refused and the page
 * pairs afresh with the refusal in view. Through every run nothing is logged
 * as an error and no content security policy violation is reported.
 *
 * Runs with `npm run test:map-pages`, which needs a Chromium.
 */

import { normaliseFingerprint, proof } from '../../../web/connect/link';
import {
  INVITE_ROOM,
  buildPage,
  findChromium,
  launchConnectBrowser,
  type ConnectBrowser,
  type ConnectPage,
  type Script,
} from '../__shared__/headlessConnectPage';

const TIMEOUT_MS = 60_000;

const BROWSER = normaliseFingerprint('sha-256', 'AA:11:22:33');
const PHONE = normaliseFingerprint('sha-256', 'BB:44:55:66');
const OTHER_PHONE = normaliseFingerprint('sha-256', 'CC:77:88:99');

/** The page draws its secret from 32 bytes of 2 under the stand-in's fixed random bytes. */
const SECRET = new Uint8Array(32).fill(2);

const ROWS = [
  {
    id: 'ride-1',
    intervalsWebId: null,
    sportType: 'Ride',
    name: 'Ridgeline loop',
    startDateLocal: '2026-03-02T07:30:00',
    distance: 42_300,
    movingTime: 5_400,
    elevationGain: 640,
    avgHr: 142,
    avgPower: 188,
    trainingLoad: 71,
  },
  {
    id: 'run-2',
    intervalsWebId: null,
    sportType: 'Run',
    name: 'Harbour sprint',
    startDateLocal: '2026-03-04T18:05:00',
    distance: 5_000,
    movingTime: 1_320,
    elevationGain: 12,
    avgHr: null,
    avgPower: null,
    trainingLoad: null,
  },
];

async function scriptFor(overrides: Partial<Script> = {}): Promise<Script> {
  return {
    browserFingerprint: BROWSER,
    invite: { fingerprint: PHONE },
    linked: { fingerprint: PHONE },
    phoneProof: await proof(SECRET, 'phone', BROWSER, PHONE),
    methods: ['link.hello', 'feed.page', 'activity.summary'],
    results: {
      'feed.page': { cards: ROWS, matchedCount: ROWS.length, hasMore: false },
      'activity.summary': {
        movingTime: 5_400,
        elapsedTime: 5_700,
        averageSpeed: 7.83,
        maxSpeed: 12.5,
      },
    },
    ...overrides,
  };
}

const text = (selector: string) =>
  `(document.querySelector(${JSON.stringify(selector)})?.textContent ?? null)`;

const chromium = findChromium();
const describeWithChromium = chromium ? describe : describe.skip;

describeWithChromium('the connect page in a headless Chromium', () => {
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
    for (const each of open) {
      expect(each.errors()).toEqual([]);
      expect(await each.evaluate('window.__fake.violations')).toEqual([]);
    }
    await browser.close();
  });

  async function visit(script: Script) {
    const visited = await browser.open(script);
    open.push(visited);
    return visited;
  }

  it(
    'shows the pairing pane with a code drawn on the canvas when nothing is kept',
    async () => {
      const connect = await visit(await scriptFor({ invite: null, linked: null }));
      await connect.until(`${text('#status')} === 'Waiting for the code to be scanned'`);
      expect(await connect.evaluate(text('h2'))).toBe('Link this browser');
      expect(INVITE_ROOM).toBe('AQEBAQEBAQEBAQEBAQEBAQ');
      await connect.until(`window.__fake.sockets.some((s) => s.url.endsWith('/${INVITE_ROOM}'))`);

      const drawn = await connect.evaluate<number>(`(() => {
        const canvas = document.getElementById('code');
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let dark = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark++;
        return dark;
      })()`);
      expect(drawn).toBeGreaterThan(1000);
      expect(await connect.evaluate(`document.getElementById('forget')`)).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    'pairs through checking and confirming to connected, lists the feed and opens an activity',
    async () => {
      const connect = await visit(await scriptFor());
      await connect.until(`${text('#status')} === 'Connected'`);
      const statuses = await connect.evaluate<string[]>('window.__fake.statuses');
      const order = ['Checking the phone', 'Confirm on your phone', 'Connected'].map((status) =>
        statuses.indexOf(status)
      );
      expect(order.every((at) => at >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);

      await connect.until(`document.querySelectorAll('#feed tbody tr').length === 2`);
      expect(
        await connect.evaluate<string[]>(
          `[...document.querySelectorAll('#feed tbody tr')].map((li) => li.querySelector('.name').textContent)`
        )
      ).toEqual(['Ridgeline loop', 'Harbour sprint']);
      expect(await connect.evaluate(text('#detail-title'))).toBe('Pick an activity');

      await connect.evaluate(`document.querySelector('#feed tbody tr').click()`);
      await connect.until(`document.querySelector('#detail dt') !== null`);
      expect(await connect.evaluate(text('#detail-title'))).toBe('Ridgeline loop');
      const facts = await connect.evaluate<string[][]>(
        `[...document.querySelectorAll('#detail dt')].map((dt) => [dt.textContent, dt.nextSibling.textContent])`
      );
      expect(facts).toContainEqual(['Distance', '42.3 km']);
      expect(facts).toContainEqual(['Moving time', '1 h 30 min']);
      expect(facts).toContainEqual(['Average speed', '28.2 km/h']);
      expect(facts).toContainEqual(['Climbing', '640 m']);
      expect(
        await connect.evaluate(
          `document.querySelector('#feed tr[aria-selected="true"] .name').textContent`
        )
      ).toBe('Ridgeline loop');
      expect(
        await connect.evaluate(`document.querySelector('#rail a[aria-current="true"]').dataset.tab`)
      ).toBe('feed');
      expect(await connect.evaluate(`document.getElementById('status').getAttribute('role')`)).toBe(
        'status'
      );

      await connect.evaluate(`location.hash = '#/settings/display-settings'`);
      await connect.until(`document.getElementById('settings-title') !== null`);
      expect(await connect.evaluate(text('#settings-title'))).toBe('Display');
      expect(
        await connect.evaluate(
          `document.querySelector('#settings-list a[aria-current="true"]').textContent`
        )
      ).toBe('Display');

      await connect.evaluate(`location.hash = '#/settings/sensor-settings'`);
      await connect.until(`${text('#settings-title')} === 'Sensors'`);
      expect(
        await connect.evaluate(
          `document.querySelectorAll('#settings-pane input, #settings-pane button, #settings-pane select').length`
        )
      ).toBe(0);
    },
    TIMEOUT_MS
  );

  it(
    'returns to waiting with an empty feed when the channel closes, and connects again',
    async () => {
      const connect = await visit(await scriptFor());
      await connect.until(`document.querySelectorAll('#feed tbody tr').length === 2`);

      await connect.evaluate('window.__fake.channel.close()');
      await connect.until(`${text('#status')} === 'Waiting for your phone'`);
      expect(await connect.evaluate(text('#waiting h2'))).toBe('Waiting for your phone');
      expect(await connect.evaluate(`document.getElementById('feed')`)).toBeNull();
      expect(await connect.evaluate(`document.getElementById('library')`)).toBeNull();

      await connect.until(`${text('#status')} === 'Connected'`, 15_000);
      await connect.until(`document.querySelectorAll('#feed tbody tr').length === 2`);
    },
    TIMEOUT_MS
  );

  it(
    'refuses a kept phone that answers with another fingerprint and pairs afresh with the notice',
    async () => {
      const paired = await visit(await scriptFor());
      await paired.until(`${text('#status')} === 'Connected'`);
      await paired.close();
      open.pop();

      const connect = await visit(
        await scriptFor({ invite: null, linked: { fingerprint: OTHER_PHONE } })
      );
      await connect.until(`${text('#pair-notice')} !== null`);
      expect(await connect.evaluate(text('#pair-notice'))).toBe(
        'The phone refused this browser. Link it again with a new code.'
      );
      expect(await connect.evaluate(text('h2'))).toBe('Link this browser');
      expect(await connect.evaluate(`document.getElementById('forget')`)).toBeNull();
    },
    TIMEOUT_MS
  );
});
