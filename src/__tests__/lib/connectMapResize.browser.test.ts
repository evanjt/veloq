/**
 * Scenario: the activity page's map has framed the track, and its container is then resized from
 * 900 to 1600 px wide and back, as a pane opening or the window changing size would.
 *
 * Expected behaviour: once each size has settled, the visible area holds the whole track, and the
 * map can be zoomed out one step from there.
 *
 * Runs with `npm run test:map-pages`, which needs a Chromium.
 */

import { SHOWN_ACTIVITY } from '../__shared__/connectDemoLibrary';
import { phoneScript } from '../__shared__/connectPhoneScripts';
import {
  buildPage,
  findChromium,
  launchConnectBrowser,
  type ConnectPage,
} from '../__shared__/headlessConnectPage';

const chromium = findChromium();
const describeWithChromium = chromium ? describe : describe.skip;

const TIMEOUT_MS = 60_000;

/** Keeps the page's own map and the box its first frame was asked to fit. */
const HOOK = `(() => {
  const Original = maplibregl.Map;
  function Hooked(options) {
    const map = new Original(options);
    window.__map = map;
    const fit = map.fitBounds.bind(map);
    map.fitBounds = (bounds, ...rest) => {
      window.__box = window.__box ?? bounds;
      return fit(bounds, ...rest);
    };
    return map;
  }
  Hooked.prototype = Original.prototype;
  Object.assign(Hooked, Original);
  maplibregl.Map = Hooked;
})()`;

const pause = (ms: number) => `new Promise((done) => setTimeout(done, ${ms}))`;

const resizeTo = (width: number) => `(async () => {
  document.querySelector('#activity-map').style.width = '${width}px';
  await ${pause(1_500)};
})()`;

/** Whether the visible area holds the whole box, and whether one step out is allowed. */
const STATE = `(() => {
  const map = window.__map;
  const [[west, south], [east, north]] = map.getBounds().toArray();
  const [[bw, bs], [be, bn]] = window.__box;
  const holds = west <= bw && south <= bs && east >= be && north >= bn;
  const zoom = map.getZoom();
  map.jumpTo({ zoom: zoom - 1 });
  const steppedOut = Math.abs(map.getZoom() - (zoom - 1)) < 1e-6;
  map.jumpTo({ zoom });
  return { holds, steppedOut };
})()`;

describeWithChromium('the activity map after its container is resized', () => {
  it('keeps the whole track in view and allows zooming out at each size', async () => {
    const built = buildPage();
    const browser = await launchConnectBrowser(chromium as string, built.dir);
    let page: ConnectPage | null = null;
    try {
      page = await browser.open(await phoneScript('demo'), 'en', { width: 1920, height: 1080 });
      await page.until(
        `document.querySelector('#status[data-state="connected"]') !== null`,
        TIMEOUT_MS
      );
      await page.evaluate(HOOK);
      await page.evaluate(`location.hash = '#/activity/${SHOWN_ACTIVITY}'`);
      await page.until(`window.__box !== undefined`, TIMEOUT_MS);
      await page.evaluate(pause(1_500));

      for (const width of [320, 1600, 320]) {
        await page.evaluate(resizeTo(width));
        expect(await page.evaluate(STATE)).toEqual({ holds: true, steppedOut: true });
      }
      expect(page.errors()).toEqual([]);
    } finally {
      await page?.close();
      await browser.close();
      built.remove();
    }
  }, 120_000);
});
