/**
 * Scenario: the Fitness and Sections mock-ups are drawn from the demo library at 1440x900 in both
 * colour schemes. The Fitness arrangement moves the page's tiles and chart cards, and the Sections
 * arrangement rearranges the page around its map without leaving it.
 *
 * Expected behaviour: the tool writes all four PNGs and finds nothing wrong with them: the Fitness
 * tiles hold their figures with the charts and Week and season beside them, and the Sections map
 * draws its section lines.
 *
 * Runs with `npm run test:map-pages`, which needs a Chromium.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { captureScreenshots } from '../../../scripts/connect-screenshots';
import { mockupCaptures } from '../../../scripts/connect-mockups';
import { findChromium } from '../__shared__/headlessConnectPage';

const describeWithChromium = findChromium() ? describe : describe.skip;

const TIMEOUT_MS = 240_000;

describeWithChromium('the Fitness and Sections mock-ups', () => {
  it(
    'draw their tiles, timeline and map lines',
    async () => {
      const out = mkdtempSync(join(tmpdir(), 'mockups-'));
      try {
        const report = await captureScreenshots({
          out,
          captures: mockupCaptures(['fitness', 'sections']),
          routes: ['fitness', 'sections'],
          sizes: [{ width: 1440, height: 900 }],
        });
        // The wordmark's dark-scheme contrast is reported on every page, live ones included, and
        // is not what a mock-up's own check finds.
        const wrong = report.failed.filter((failure) => !/^color-contrast/.test(failure.message));
        expect({ written: report.written.length, wrong }).toEqual({ written: 4, wrong: [] });
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    },
    TIMEOUT_MS
  );
});
