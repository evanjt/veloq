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
 * as an error and no content security policy violation is reported. On the map
 * screen the built page mounts a map canvas under the deployed policy with the
 * renderer the app ships, asks the phone once for each heatmap tile the
 * viewport covers, draws a route line from the phone's GeoJSON and reports a
 * hover over it by its id, reaching no host but the basemap's.
 *
 * Runs with `npm run test:map-pages`, which needs a Chromium.
 */

import { normaliseFingerprint, proof } from '../../../web/connect/link';
import vectors from '../../../modules/veloqrs/rust/veloqrs/tests/fixtures/track_codec_vectors.json';
import { greyPng } from '../__shared__/headlessMapPage';
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
    hasGps: true,
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

/** The ride's preview line as the phone sends it: the engine's track encoding, base64. */
const RIDE_LINE = Buffer.from(
  vectors.cases.find((entry) => entry.name === 'every point carries elevation')?.bytes ?? []
).toString('base64');

/** The feed page the phone answers: the two rows, and the ride's line; the run has no track. */
const FEED_PAGE = {
  cards: ROWS,
  matchedCount: ROWS.length,
  hasMore: false,
  previews: [{ activityId: 'ride-1', encodedCoords: RIDE_LINE }],
};

async function scriptFor(overrides: Partial<Script> = {}): Promise<Script> {
  return {
    browserFingerprint: BROWSER,
    invite: { fingerprint: PHONE },
    linked: { fingerprint: PHONE },
    phoneProof: await proof(SECRET, 'phone', BROWSER, PHONE),
    methods: ['link.hello', 'feed.page', 'activity.summary'],
    stats: [
      {
        id: 'T',
        type: 'transport',
        selectedCandidatePairId: 'P',
        bytesSent: 1_000,
        bytesReceived: 2_000,
        timestamp: 5_000,
      },
      {
        id: 'P',
        type: 'candidate-pair',
        localCandidateId: 'L',
        remoteCandidateId: 'R',
        currentRoundTripTime: 0.042,
        state: 'succeeded',
        nominated: true,
      },
      {
        id: 'L',
        type: 'local-candidate',
        candidateType: 'host',
        address: '192.0.2.20',
        port: 52000,
      },
      {
        id: 'R',
        type: 'remote-candidate',
        candidateType: 'host',
        address: '192.0.2.31',
        port: 41000,
      },
    ],
    results: {
      'feed.page': FEED_PAGE,
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

/** One route across the equator, as the phone writes a route-line layer. */
const ROUTE_LINES = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'route-1',
      properties: { number: 1, name: 'Ridgeline loop' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-30, 0],
          [30, 0],
        ],
      },
    },
  ],
});

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

  async function visit(script: Script, languages?: string) {
    const visited = await browser.open(script, languages);
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

  it.each([
    ['fr', 'fr', 'Connecté', 'Associer ce navigateur'],
    ['ja', 'ja', '接続済み', 'このブラウザーをリンク'],
    ['de-CH,fr', 'de-CH', 'Verbunden', 'Diesen Browser verknüpfen'],
    ['xx', 'en-GB', 'Connected', 'Link this browser'],
  ])(
    'speaks %s from its own chunk once the phone connects',
    async (accept, tag, connected, heading) => {
      const pairing = await visit(await scriptFor({ invite: null, linked: null }), accept);
      await pairing.until(`${text('h2')} === ${JSON.stringify(heading)}`);
      expect(await pairing.evaluate('document.documentElement.lang')).toBe(tag);

      const connect = await visit(await scriptFor(), accept);
      await connect.until(`${text('#status')} === ${JSON.stringify(connected)}`);
      expect(await connect.evaluate('document.documentElement.lang')).toBe(tag);
    },
    TIMEOUT_MS
  );

  it(
    'pairs through checking and confirming to connected, lists the feed and opens an activity',
    async () => {
      const connect = await visit(await scriptFor({ device: 'Trail handset' }));
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
      expect(
        await connect.evaluate<string[]>(
          `[...document.querySelectorAll('#feed tbody tr')].map((tr) => { const thumb = tr.querySelector('.thumb'); return thumb.tagName.toLowerCase() + ':' + thumb.dataset.sport + ':' + (thumb.querySelector('path')?.getAttribute('d')?.charAt(0) ?? thumb.textContent); })`
        )
      ).toEqual(['svg:ride:M', 'span:run:U']);
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

      await connect.evaluate(`document.querySelector('#connection .chip').click()`);
      await connect.until(
        `[...document.querySelectorAll('#connection-details dd')].some((dd) => dd.textContent === 'Direct, on the same network')`
      );
      const details = await connect.evaluate<string[][]>(
        `[...document.querySelectorAll('#connection-details dt')].map((dt) => [dt.textContent, dt.nextSibling.textContent])`
      );
      expect(details).toContainEqual(['This browser', '192.0.2.20:52000']);
      expect(details).toContainEqual(['Phone', '192.0.2.31:41000']);
      expect(details).toContainEqual(['Round trip', '42 ms']);
      expect(await connect.evaluate(text('#connection-phone'))).toBe('Trail handset');
      expect(await connect.evaluate(text('#rail .phone'))).toBe('Trail handset');

      await connect.evaluate(
        `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`
      );
      await connect.until(`document.getElementById('connection-details') === null`);
      expect(await connect.evaluate(`document.activeElement.matches('#connection .chip')`)).toBe(
        true
      );
      expect(await connect.evaluate(text('#detail-title'))).toBe('Ridgeline loop');
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
    'shows the phone settings, profile and linked devices in the settings panes, with no control',
    async () => {
      const connect = await visit(
        await scriptFor({
          methods: [
            'link.hello',
            'feed.page',
            'settings.get',
            'settings.profile',
            'status.linkedDevices',
          ],
          results: {
            'feed.page': FEED_PAGE,
            'settings.get': {
              values: [
                { key: 'veloq-unit-preference', value: 'imperial' },
                { key: 'veloq-theme-preference', value: null },
              ],
              refused: [],
            },
            'settings.profile': { name: 'Sam', measurementPreference: 'meters', weightKg: 70 },
            'status.linkedDevices': {
              devices: [
                { id: '1', name: 'Laptop', createdAt: 1, lastSeenAt: null, connectedSince: null },
                { id: '2', name: 'Desk', createdAt: 1, lastSeenAt: null, connectedSince: 2 },
              ],
              thisBrowser: '2',
            },
          },
        })
      );
      await connect.until(`document.querySelectorAll('#feed tbody tr').length === 2`);
      await connect.evaluate(`location.hash = '#/settings/display-settings'`);
      await connect.until(`document.querySelector('#settings-rows dt') !== null`);
      expect(
        await connect.evaluate<string[][]>(
          `[...document.querySelectorAll('#settings-rows dt')].map((dt) => [dt.textContent, dt.nextSibling.querySelector('select, input').value])`
        )
      ).toEqual([
        ['Theme', ''],
        ['Units', 'imperial'],
      ]);
      expect(
        await connect.evaluate(
          `[...document.querySelectorAll('#settings-pane input, #settings-pane button, #settings-pane select')].every((control) => control.disabled)`
        )
      ).toBe(true);

      await connect.evaluate(`location.hash = '#/settings/linked-devices'`);
      await connect.until(`document.querySelectorAll('#settings-devices li').length === 2`);
      expect(
        await connect.evaluate<string[]>(
          `[...document.querySelectorAll('#settings-devices li')].map((li) => li.textContent)`
        )
      ).toEqual(['Laptop', 'Desk (this browser)']);

      await connect.evaluate(`location.hash = '#/settings'`);
      await connect.until(`document.querySelector('#settings-profile dd') !== null`);
      expect(await connect.evaluate(text('#settings-profile dd'))).toBe('Sam');
      expect(await connect.evaluate(text('#rail .phone'))).toBe('Your phone');
      expect(await connect.evaluate(`document.getElementById('later')`)).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    'draws the strength tab for its period and opens a recording from the recordings list',
    async () => {
      const recording = {
        id: 'rec/1',
        name: 'Morning spin',
        activityType: 'Ride',
        startTime: Date.UTC(2026, 2, 2, 7, 30),
        durationSeconds: 3_600,
        distanceMeters: 30_000,
        elevationGain: 210,
        avgHeartrate: null,
        uploadStatus: 'pending',
        lastError: null,
        notes: null,
      };
      const connect = await visit(
        await scriptFor({
          methods: [
            'link.hello',
            'feed.page',
            'strength.screen',
            'recordings.list',
            'recordings.get',
          ],
          results: {
            'feed.page': FEED_PAGE,
            'strength.screen': {
              owedCount: 2,
              summary: {
                muscleVolumes: [
                  {
                    slug: 'upper-back',
                    weightedSets: 4.5,
                    totalReps: 40,
                    volumeKg: 812.4,
                    exerciseNames: ['Row'],
                  },
                ],
              },
              weekly: [],
              exercises: [],
            },
            'recordings.list': { recordings: [recording] },
            'recordings.get': { recording },
          },
        })
      );
      await connect.until(`document.querySelectorAll('#feed tbody tr').length === 2`);

      await connect.evaluate(`location.hash = '#/insights?type=strength&period=1m'`);
      await connect.until(`document.querySelector('#strength-muscle-rows tr') !== null`);
      expect(
        await connect.evaluate<string[]>(
          `[...document.querySelectorAll('#strength-muscle-rows td')].map((td) => td.textContent)`
        )
      ).toEqual(['Upper back', '4.5', '40', '812', 'Row']);
      expect(await connect.evaluate(text('#strength-periods a[aria-current="true"]'))).toBe(
        '30 days'
      );
      expect(await connect.evaluate(text('#strength-owed'))).toBe(
        '2 strength activities have no sets on your phone yet.'
      );
      const asked = await connect.evaluate<{ method: string; params: { periodDays?: number } }[]>(
        'window.__fake.channel.sent'
      );
      expect(
        asked.filter((ask) => ask.method === 'strength.screen').map((ask) => ask.params.periodDays)
      ).toEqual([30]);

      await connect.evaluate(`location.hash = '#/recordings'`);
      await connect.until(`document.querySelector('#recordings-list a') !== null`);
      await connect.evaluate(`document.querySelector('#recordings-list a').click()`);
      await connect.until(`${text('#recording-title')} === 'Morning spin'`);
      const facts = await connect.evaluate<string[][]>(
        `[...document.querySelectorAll('#recording-facts dt')].map((dt) => [dt.textContent, dt.nextSibling.textContent])`
      );
      expect(facts).toContainEqual(['Distance', '30.0 km']);
      expect(facts).toContainEqual(['Upload', 'pending']);
    },
    TIMEOUT_MS
  );

  it(
    'draws the fitness panels the phone answers and asks the range panels again for a new range',
    async () => {
      const connect = await visit(
        await scriptFor({
          methods: ['link.hello', 'feed.page', 'fitness.screen', 'fitness.wellness'],
          results: {
            'feed.page': FEED_PAGE,
            'fitness.screen': {
              cyclingFtpSetting: 251.4,
              ftpTrend: { latestFtp: null },
              runningLthr: null,
              sportMix: { rides: 3, runs: 1, swims: 0 },
              loadDots: [],
              heatmap: [],
              months: [],
              seasonYear: {
                currentStats: { count: 0, totalDuration: 0, totalDistance: 0, totalTss: 0 },
                previousStats: { count: 0, totalDuration: 0, totalDistance: 0, totalTss: 0 },
              },
              comparisons: {
                week: {
                  currentStats: { count: 0, totalDuration: 0, totalDistance: 0, totalTss: 0 },
                  previousStats: { count: 0, totalDuration: 0, totalDistance: 0, totalTss: 0 },
                },
              },
            },
            'fitness.wellness': {
              coverage: 'notFetched',
              days: [
                { date: '2026-03-01', ctl: 50, atl: 60 },
                { date: '2026-03-02', ctl: 51, atl: null },
              ],
            },
          },
        })
      );
      await connect.until(`document.querySelectorAll('#feed tbody tr').length === 2`);
      await connect.evaluate(`location.hash = '#/fitness'`);
      await connect.until(`document.querySelector('#panel-screen dt') !== null`);
      expect(
        await connect.evaluate<string[][]>(
          `[...document.querySelectorAll('#panel-screen dt')].map((dt) => [dt.textContent, dt.nextSibling.textContent])`
        )
      ).toEqual([
        ['Cycling FTP', '251 W'],
        ['Recent rides', '3'],
        ['Recent runs', '1'],
        ['Recent swims', '0'],
      ]);
      await connect.until(`document.querySelectorAll('#panel-wellness path').length === 2`);
      expect(await connect.evaluate(text('#panel-wellness .empty'))).toBe(
        'Wellness for this range has not been downloaded on the phone.'
      );
      expect(await connect.evaluate(`document.getElementById('panel-loads').textContent`)).toBe('');

      const wellnessAsks = () =>
        connect.evaluate<number>(
          `window.__fake.channel.sent.filter((ask) => ask.method === 'fitness.wellness').length`
        );
      expect(await wellnessAsks()).toBe(1);
      await connect.evaluate(
        `[...document.querySelectorAll('#range button')].find((b) => b.textContent === '180 days').click()`
      );
      await connect.until(
        `document.querySelector('#range button[aria-pressed="true"]').textContent === '180 days'`
      );
      await connect.until(
        `window.__fake.channel.sent.filter((ask) => ask.method === 'fitness.wellness').length === 2`
      );
    },
    TIMEOUT_MS
  );

  it(
    'draws the map under the deployed policy, asks for each heatmap tile in view once and reports a hover over a line',
    async () => {
      const tile = greyPng().toString('base64');
      const connect = await visit(
        await scriptFor({
          methods: ['link.hello', 'feed.page', 'heatmap.tile', 'geo.routeLines'],
          results: {
            'feed.page': FEED_PAGE,
            'geo.routeLines': { text: ROUTE_LINES },
          },
          tiles: { '2/1/1': tile, '2/2/1': tile },
        })
      );
      await connect.until(`${text('#status')} === 'Connected'`);
      await connect.evaluate(`location.hash = '#/map'`);
      await connect.until(`document.querySelector('#map-screen .maplibregl-canvas') !== null`);

      const view = await connect.evaluate<{ width: number; height: number }>(
        `(() => { const r = document.querySelector('.map-canvas').getBoundingClientRect(); return { width: r.width, height: r.height }; })()`
      );
      // Zoom 2 of 512 px tiles is a 2048 px world centred on the map's middle.
      const columns = [
        Math.floor((1024 - view.width / 2) / 512),
        Math.floor((1024 + view.width / 2) / 512),
      ];
      const rows = [
        Math.floor((1024 - view.height / 2) / 512),
        Math.floor((1024 + view.height / 2) / 512),
      ];
      const covered: string[] = [];
      for (let x = columns[0] as number; x <= (columns[1] as number); x++) {
        for (let y = rows[0] as number; y <= (rows[1] as number); y++) covered.push(`2/${x}/${y}`);
      }
      const asked = () =>
        connect.evaluate<string[]>(
          `window.__fake.channel.sent.filter((s) => s.method === 'heatmap.tile').map((s) => s.params.z + '/' + s.params.x + '/' + s.params.y + '/' + s.params.base)`
        );
      await connect.until(
        `window.__fake.channel.sent.filter((s) => s.method === 'heatmap.tile').length >= ${covered.length}`
      );
      const tiles = await asked();
      expect(new Set(tiles).size).toBe(tiles.length);
      expect([...tiles].sort()).toEqual(covered.map((key) => `${key}/light`).sort());

      await connect.until(
        `(() => {
          const canvas = document.querySelector('.maplibregl-canvas');
          const r = canvas.getBoundingClientRect();
          canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
          return document.getElementById('map-hover').textContent === 'Route 1';
        })()`
      );
      await connect.evaluate(
        `document.querySelector('.maplibregl-canvas').dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 2, clientY: 2 }))`
      );
      await connect.until(`document.getElementById('map-hover').textContent === ''`);
    },
    TIMEOUT_MS
  );

  it(
    'answers a read again from what it holds, and asks the phone again once the library changed',
    async () => {
      const connect = await visit(await scriptFor());
      const asks = (method: string) =>
        connect.evaluate<number>(
          `window.__fake.channel.sent.filter((ask) => ask.method === ${JSON.stringify(method)}).length`
        );
      await connect.until(`document.querySelectorAll('#feed tbody tr').length === 2`);
      await connect.evaluate(`document.querySelector('#feed tbody tr').click()`);
      await connect.until(`document.querySelector('#detail dt') !== null`);
      expect(await asks('feed.page')).toBe(1);
      expect(await asks('activity.summary')).toBe(1);

      await connect.evaluate(`(() => {
        const body = new TextEncoder().encode(JSON.stringify({ event: 'changed', generation: 2 }));
        const frame = new Uint8Array(10 + body.length);
        const view = new DataView(frame.buffer);
        view.setUint8(0, 1);
        view.setUint8(1, 2);
        view.setUint32(2, 0);
        view.setUint32(6, 0);
        frame.set(body, 10);
        window.__fake.channel.onmessage({ data: frame.buffer });
      })()`);
      await connect.until(
        `window.__fake.channel.sent.filter((ask) => ask.method === 'feed.page').length === 2`
      );
      await connect.until(
        `window.__fake.channel.sent.filter((ask) => ask.method === 'activity.summary').length === 2`
      );
      expect(await connect.evaluate(text('#status'))).toBe('Connected');
      await connect.until(`document.querySelectorAll('#feed tbody tr').length === 2`);
    },
    TIMEOUT_MS
  );

  it(
    'acts at once on the phone saying why it leaves: waiting when it goes away, pairing afresh when removed',
    async () => {
      const connect = await visit(await scriptFor());
      const farewell = (reason: string) =>
        connect.evaluate(`(() => {
          const body = new TextEncoder().encode(JSON.stringify({ event: 'farewell', reason: ${JSON.stringify(reason)} }));
          const frame = new Uint8Array(10 + body.length);
          const view = new DataView(frame.buffer);
          view.setUint8(0, 1);
          view.setUint8(1, 2);
          frame.set(body, 10);
          window.__fake.channel.onmessage({ data: frame.buffer });
        })()`);
      await connect.until(`document.querySelectorAll('#feed tbody tr').length === 2`);
      await farewell('background');
      await connect.until(`${text('#status')} === 'Waiting for your phone'`);

      await connect.until(`${text('#status')} === 'Connected'`, 15_000);
      await connect.until(`document.querySelectorAll('#feed tbody tr').length === 2`);
      await farewell('removed');
      // The page invites afresh at once, and the stand-in phone takes the new
      // code straight away, so the notice is read while it is on screen.
      await connect.until(
        `${text('#pair-notice')} === 'This browser was removed on the phone. Link it again with a new code.'`
      );
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
