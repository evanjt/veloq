/**
 * Scenario: the activity page and the fitness page are opened on the scripted demo phone in a 2560
 * by 1440 window, where a plot sized by a fixed number of pixels would be a thin strip.
 *
 * Expected behaviour: the plot rectangle of every chart is at most 6 times wider than it is high
 * and that of every lane at most 10 times; hovering the fitness chart puts the wellness lanes'
 * crosshair at the same date, and the pointer leaving removes it; nothing is logged as an error.
 *
 * Runs with `npm run test:map-pages`, which needs a Chromium.
 */

import { normaliseFingerprint, proof } from '../../../web/connect/link';
import { SHOWN_ACTIVITY, demoScript } from '../__shared__/connectDemoLibrary';
import {
  buildPage,
  findChromium,
  launchConnectBrowser,
  type ConnectBrowser,
  type ConnectPage,
} from '../__shared__/headlessConnectPage';

const TIMEOUT_MS = 90_000;
const SIZE = { width: 2560, height: 1440 };
/** The plot height is rounded up to a whole pixel, which can take a ratio just under its bound. */
const SLACK = 0.02;

const BROWSER = normaliseFingerprint('sha-256', 'AA:11:22:33');
const PHONE = normaliseFingerprint('sha-256', 'BB:44:55:66');
const SECRET = new Uint8Array(32).fill(2);
const CONNECTED = `document.querySelector('#status[data-state="connected"]') !== null`;

type Plot = { lane: boolean; width: number; height: number; label: string };

/** Each plot rectangle of each chart figure on the page, with whether the figure is a lane stack. */
const PLOTS = `[...document.querySelectorAll('figure.chart')].flatMap((figure) =>
  [...figure.querySelectorAll('svg rect.plot')].map((rect) => {
    const box = rect.getBoundingClientRect();
    return {
      lane: figure.classList.contains('lanes'),
      width: box.width,
      height: box.height,
      label: figure.querySelector('svg')?.getAttribute('aria-label') ?? '',
    };
  }))`;

const chromium = findChromium();
const describeWithChromium = chromium ? describe : describe.skip;

describeWithChromium('the chart plots at 2560 by 1440', () => {
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
      SIZE
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

  const expectShaped = (plots: Plot[]) => {
    expect(plots.length).toBeGreaterThan(0);
    for (const plot of plots) {
      const bound = plot.lane ? 10 : 6;
      expect({ label: plot.label, tooFlat: plot.width / plot.height > bound + SLACK }).toEqual({
        label: plot.label,
        tooFlat: false,
      });
    }
  };

  it(
    'keeps every lane of the activity page at most 10 to 1',
    async () => {
      await open(
        `#/activity/${SHOWN_ACTIVITY}`,
        `document.querySelectorAll('#activity-lanes .lane').length > 2`
      );
      const plots = await connect.evaluate<Plot[]>(PLOTS);
      expect(plots.some((plot) => plot.lane)).toBe(true);
      expectShaped(plots);
    },
    TIMEOUT_MS
  );

  it(
    'keeps every chart of the fitness page at most 6 to 1 and every lane at most 10 to 1',
    async () => {
      await open('#/fitness', `document.querySelectorAll('#fitness-page figure.chart').length > 1`);
      expectShaped(await connect.evaluate<Plot[]>(PLOTS));
    },
    TIMEOUT_MS
  );

  it(
    'shows the wellness crosshair at the date under the pointer on the fitness chart',
    async () => {
      await open('#/fitness', `document.querySelectorAll('#fitness-page figure.chart').length > 1`);
      const hover = (type: string, fraction: number) =>
        connect.evaluate(`(() => {
          const svg = document.querySelector('#fitness-page figure.chart:not(.lanes) svg[role="group"]');
          const plot = svg.querySelector('rect.plot').getBoundingClientRect();
          svg.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, {
            bubbles: true,
            clientX: plot.left + plot.width * ${fraction},
            clientY: plot.top + plot.height / 2,
          }));
        })()`);
      const lanesCrosshair = `document.querySelector('#fitness-page figure.chart.lanes line.crosshair') !== null`;
      const dateOf = (selector: string) =>
        connect.evaluate<string>(
          `document.querySelector(${JSON.stringify(selector)}).textContent.split(' · ')[0].trim()`
        );

      expect(await connect.evaluate<boolean>(lanesCrosshair)).toBe(false);
      await hover('pointermove', 0.5);
      await connect.until(lanesCrosshair, TIMEOUT_MS);
      const chartDate = await dateOf('#fitness-page figure.chart:not(.lanes) .readout');
      expect(chartDate).not.toBe('');
      expect(await dateOf('#fitness-page figure.chart.lanes .readout')).toBe(chartDate);
      await hover('pointerout', 0.5);
      await connect.until(`!(${lanesCrosshair})`, TIMEOUT_MS);
    },
    TIMEOUT_MS
  );
});
