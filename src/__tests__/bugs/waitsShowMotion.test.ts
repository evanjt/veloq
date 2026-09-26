/**
 * Scenario: the app draws a wait. Evan, 2026-09-18: "when things are loading we
 * should show active loading indicators, not just an icon of downloading or
 * whatever."
 *
 * Expected behaviour: a wait shows motion. `MaterialCommunityIcons name="loading"`
 * is a glyph of a spinner, not a spinner: it draws one static arc and stays
 * there, and three screens used it as though it turned. A settled state, no GPS,
 * not downloaded after the sync gave up, failed, keeps its static glyph.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runGit } from '../__shared__/gitFixture';

const ROOT = join(__dirname, '../../..');

/**
 * Every tracked `.tsx` under `src`, which is where a glyph can be drawn.
 *
 * Through the helper: git hands a hook `GIT_INDEX_FILE` and seven more
 * pointers, and they beat `cwd`, so a bare listing under `pre-commit` is of
 * the index being written rather than of the checkout.
 */
function componentFiles(): string[] {
  return runGit(['ls-files', 'src/**/*.tsx'], ROOT)
    .split('\n')
    .filter((path) => path.length > 0 && !path.includes('__tests__'));
}

it('draws no wait as the static loading glyph', () => {
  const offenders = componentFiles().filter((path) =>
    /name="loading"/.test(readFileSync(join(ROOT, path), 'utf8'))
  );

  expect(offenders).toEqual([]);
});
