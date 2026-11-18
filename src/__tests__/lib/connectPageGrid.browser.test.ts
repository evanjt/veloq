/**
 * Scenario: the connect page's chart pages are opened in windows of 1920 and 2560 px, where the
 * dashboard cells once spanned two thirds of the width and the insight cards stayed 313 px wide
 * with empty tracks beside them.
 *
 * Expected behaviour: on the fitness and insights pages the rightmost card ends within 24 px of
 * the content's right edge, or of the 2000 px cap the page grid holds, and no card is wider than
 * two tracks of the grid it sits in.
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
const GRID_CAP = 2000;
const EDGE_TOLERANCE = 24;

const BROWSER = normaliseFingerprint('sha-256', 'AA:11:22:33');
const PHONE = normaliseFingerprint('sha-256', 'BB:44:55:66');
const SECRET = new Uint8Array(32).fill(2);

const CONNECTED = `document.querySelector('#status[data-state="connected"]') !== null`;

type Layout = {
  pageLeft: number;
  pageRight: number;
  cards: { right: number; width: number; track: number; gap: number }[];
};

/**
 * Every card of a page: its right edge, its width and the width of one track of the grid it sits
 * in, taking the grid item that holds the card as the card's own width.
 */
const layoutOf = (page: string, cards: string) => `(() => {
  const root = document.querySelector(${JSON.stringify(page)}).getBoundingClientRect();
  const out = [];
  for (const card of document.querySelectorAll(${JSON.stringify(cards)})) {
    let item = card;
    while (item.parentElement && getComputedStyle(item.parentElement).display !== 'grid') {
      item = item.parentElement;
    }
    const grid = item.parentElement;
    if (!grid) continue;
    const style = getComputedStyle(grid);
    const tracks = style.gridTemplateColumns.split(' ').map(parseFloat);
    const gap = parseFloat(style.columnGap) || 0;
    const box = item.getBoundingClientRect();
    out.push({
      right: box.right,
      width: box.width,
      track: Math.min(...tracks),
      gap,
    });
  }
  return { pageLeft: root.left, pageRight: root.right, cards: out };
})()`;

const chromium = findChromium();
const describeWithChromium = chromium ? describe : describe.skip;

describeWithChromium('the connect chart pages on a wide window in a headless Chromium', () => {
  let page: { dir: string; remove: () => void };
  let browser: ConnectBrowser;
  let connect: ConnectPage;

  beforeAll(() => {
    page = buildPage();
  }, TIMEOUT_MS);

  afterAll(() => page.remove());

  afterEach(async () => {
    expect(connect.errors()).toEqual([]);
    await browser.close();
  });

  async function openAt(width: number, hash: string, ready: string) {
    browser = await launchConnectBrowser(chromium as string, page.dir);
    connect = await browser.open(
      demoScript({
        browserFingerprint: BROWSER,
        phoneFingerprint: PHONE,
        phoneProof: await proof(SECRET, 'phone', BROWSER, PHONE),
      }),
      undefined,
      { width, height: 1200 }
    );
    await connect.until(CONNECTED, TIMEOUT_MS);
    await connect.evaluate(`location.hash = '${hash}'`);
    await connect.until(ready, TIMEOUT_MS);
  }

  function expectFilled(layout: Layout) {
    expect(layout.cards.length).toBeGreaterThan(0);
    const edge = Math.min(layout.pageRight, layout.pageLeft + GRID_CAP);
    const rightmost = Math.max(...layout.cards.map((card) => card.right));
    expect(rightmost).toBeGreaterThanOrEqual(edge - EDGE_TOLERANCE);
    expect(rightmost).toBeLessThanOrEqual(layout.pageLeft + GRID_CAP + 1);
    for (const card of layout.cards) {
      expect(card.width).toBeLessThanOrEqual(2 * card.track + card.gap + 1);
    }
  }

  it.each([1920, 2560])(
    'fills the fitness page to its right edge or the cap at %i px, with no card over two tracks',
    async (width) => {
      await openAt(
        width,
        '#/fitness',
        `document.querySelectorAll('#fitness-page .ui-card').length > 0`
      );
      expectFilled(
        await connect.evaluate<Layout>(layoutOf('#fitness-page', '#fitness-page .ui-card'))
      );
    },
    TIMEOUT_MS
  );

  it.each([1920, 2560])(
    'fills the insights card grid to its right edge or the cap at %i px',
    async (width) => {
      await openAt(
        width,
        '#/insights',
        `document.querySelectorAll('#insight-cards article').length > 0`
      );
      expectFilled(
        await connect.evaluate<Layout>(layoutOf('#insights-page', '#insight-cards > section'))
      );
    },
    TIMEOUT_MS
  );
});
