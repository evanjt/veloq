/**
 * Scenario: a Rust test target that executes nothing. A file gating on a
 * feature with no matching Cargo stanza compiles to an empty binary, prints
 * `running 0 tests` and `ok`, and every gate reads it as a pass. The resume
 * suite was red on main for days behind exactly that.
 *
 * Expected behaviour: a target that lists no tests fails the job, and a `bin`
 * target, which has no tests by design, does not.
 */

import fs from 'fs';
import path from 'path';

const { emptySuites } = require('../../../scripts/lint-empty-test-binaries');

const REPO = path.resolve(__dirname, '../../..');

/**
 * `testcases` is an object keyed by test name, not an array. Counting it as an
 * array reads every target as non-empty and the guard passes everything.
 */
function suite(kind: string, ...names: string[]) {
  return { kind, testcases: Object.fromEntries(names.map((n) => [n, { ignored: false }])) };
}

function list(suites: Record<string, ReturnType<typeof suite>>) {
  return { 'test-count': 0, 'rust-suites': suites };
}

describe('empty test binary guard', () => {
  it('names a test target that lists nothing', () => {
    const empty = emptySuites(
      list({
        'veloqrs::detection_resume': suite('test', 'a_resumed_run'),
        'veloqrs::evidence_cache_encode_off_lock': suite('test'),
      })
    );

    expect(empty).toEqual(['veloqrs::evidence_cache_encode_off_lock']);
  });

  it('leaves a bin target alone, which carries no tests by design', () => {
    const empty = emptySuites(
      list({
        'veloqrs::bin/uniffi-bindgen': suite('bin'),
        veloqrs: suite('lib', 'basemap::tests::a_template_fills'),
      })
    );

    expect(empty).toEqual([]);
  });

  it('catches the crate lib itself reporting nothing', () => {
    const empty = emptySuites(list({ veloqrs: suite('lib') }));

    expect(empty).toEqual(['veloqrs']);
  });

  it('answers nothing for a list with no suites rather than passing it', () => {
    expect(() => emptySuites(list({}))).toThrow(/no test targets/);
  });

  it('runs in CI under the same feature set as the suite it guards', () => {
    const workflow = fs.readFileSync(path.join(REPO, '.github/workflows/test.yml'), 'utf8');
    const invocation = workflow
      .split('\n')
      .find((line) => line.includes('scripts/lint-empty-test-binaries.js'));

    expect(invocation).toBeDefined();
    expect(invocation).toContain('--features synthetic');
  });
});
