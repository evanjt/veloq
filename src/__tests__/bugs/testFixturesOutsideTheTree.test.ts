/**
 * Scenario: three gate suites scan the whole repository from a child process,
 * `mergeLintCeiling` with `eslint .`, `reachabilityAuditExitCode` and
 * `renderEngineReadLintExitCode` with a node scanner. Under a full Jest run
 * they see whatever any other suite has momentarily put in the tree.
 *
 * Expected behaviour: no test writes a fixture into the repository. The one
 * that did, the font-size lint, wrote `src/typeLintFixture.<n>.ts` and removed
 * it in a `finally`, and the scanners caught it half-there:
 *
 *     Error: ENOENT: no such file or directory, open
 *       '.../src/typeLintFixture.TC3rGO.ts'
 *
 * The gate then failed on a command error rather than on what it measures,
 * and every commit that day carried `--no-verify`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');
const TESTS = join(ROOT, 'src/__tests__');

function everyTestFile(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return everyTestFile(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/**
 * A path built from the repository root into `src/`, and a call that puts
 * something there. Reading a tracked file that way is what most of these
 * suites do and is fine. `mkdtempSync` under `tmpdir()` is the shape a fixture
 * is meant to take and matches neither.
 */
const REPO_SRC_PATH = /join\(\s*(?:process\.cwd\(\)|ROOT|__dirname)\s*,\s*['"`]src/;
const CREATES_A_FILE = /\b(?:writeFileSync|appendFileSync|copyFileSync|cpSync|mkdirSync)\s*\(/;

function writesIntoTheTree(source: string): boolean {
  return REPO_SRC_PATH.test(source) && CREATES_A_FILE.test(source);
}

describe('a test fixture lives outside the tree the gates scan', () => {
  const files = everyTestFile(TESTS);

  it('finds the test files at all, so an empty pass is not a pass', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('has no test building a fixture path under src/', () => {
    const offenders = files
      .filter((file) => writesIntoTheTree(readFileSync(file, 'utf8')))
      .map((file) => file.slice(ROOT.length + 1));

    expect(offenders).toEqual([]);
  });
});
