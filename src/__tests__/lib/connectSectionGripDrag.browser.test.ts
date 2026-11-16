/**
 * Scenario: the section page's bounds editor is opened from Edit bounds and one end grip is
 * dragged with a pointer in a real browser, with the map under it.
 *
 * Expected behaviour: while the pointer is held the grip moves towards it along the line, the
 * length shown in the editor changes once the pointer is up, the other grip stays where it was
 * on screen (the map does not pan under a grip being dragged), and the grip is left on the
 * vertex the page chose rather than where the pointer let go.
 *
 * Runs with `npm run test:map-pages`, which needs a Chromium.
 */

import { phoneScript } from '../__shared__/connectPhoneScripts';
import {
  buildPage,
  findChromium,
  launchConnectBrowser,
  type ConnectPage,
  type Point,
} from '../__shared__/headlessConnectPage';

const chromium = findChromium();
const describeWithChromium = chromium ? describe : describe.skip;

const TIMEOUT_MS = 60_000;

const gripCentre = (handle: string) => `(() => {
  const box = document.querySelector('.map-handle[data-handle="${handle}"]')?.getBoundingClientRect();
  return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
})()`;

const lengthText = `document.querySelector('#bounds-length')?.textContent ?? ''`;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const pause = (ms: number) => `new Promise((done) => setTimeout(done, ${ms}))`;

async function openSectionEditor(page: ConnectPage): Promise<void> {
  await page.until(
    `document.querySelector('#status[data-state="connected"]') !== null`,
    TIMEOUT_MS
  );
  await page.evaluate(`location.hash = '#/section/section-0'`);
  await page.until(`document.querySelector('#section-body .section-name') !== null`, TIMEOUT_MS);
  await page.evaluate(
    `[...document.querySelectorAll('.section-actions button')].find((b) => b.textContent === 'Edit bounds')?.click()`
  );
  await page.until(`document.querySelectorAll('.map-handle').length === 2`, TIMEOUT_MS);
  await page.until(`document.querySelector('#bounds-length')?.textContent !== ''`, TIMEOUT_MS);
  // The editor's first fit of the map to the line settles within a second of opening.
  await page.evaluate(pause(1_500));
}

describeWithChromium('the section bounds grips under a pointer', () => {
  it('moves the end grip along the line, snaps it on release and leaves the map where it was', async () => {
    const built = buildPage();
    const browser = await launchConnectBrowser(chromium as string, built.dir);
    let page: ConnectPage | null = null;
    try {
      page = await browser.open(await phoneScript('demo'), 'en', { width: 1280, height: 800 });
      await openSectionEditor(page);

      const lengthBefore = await page.evaluate<string>(lengthText);
      const startBefore = await page.evaluate<Point>(gripCentre('start'));
      const endBefore = await page.evaluate<Point>(gripCentre('end'));

      // Three quarters of the way from the end grip towards the start grip.
      const to: Point = {
        x: endBefore.x + (startBefore.x - endBefore.x) * 0.25,
        y: endBefore.y + (startBefore.y - endBefore.y) * 0.25,
      };
      const whileHeld: Point[] = [];
      const current = page;
      await page.drag(endBefore, to, {
        whileHeld: async () => {
          whileHeld.push(await current.evaluate<Point>(gripCentre('end')));
        },
      });
      expect(distance(whileHeld[0] as Point, to)).toBeLessThan(distance(endBefore, to));

      await page.evaluate(pause(800));
      const lengthAfter = await page.evaluate<string>(lengthText);
      const startAfter = await page.evaluate<Point>(gripCentre('start'));
      const endAfter = await page.evaluate<Point>(gripCentre('end'));

      expect(lengthAfter).not.toBe(lengthBefore);
      expect(distance(startAfter, startBefore)).toBeLessThan(1);
      expect(distance(endAfter, to)).toBeGreaterThan(5);

      await page.evaluate(pause(800));
      expect(await page.evaluate<Point>(gripCentre('end'))).toEqual(endAfter);
      expect(await page.evaluate<string>(lengthText)).toBe(lengthAfter);
      expect(page.errors()).toEqual([]);
    } finally {
      await page?.close();
      await browser.close();
      built.remove();
    }
  }, 120_000);
});
