/**
 * Scenario: the orphan report is what decides whether an engine method is app
 * surface or test scaffolding. It matched callers with `.name(` alone, so an
 * associated function called as `Type::name(` looked uncalled, and it listed
 * three constructors that between them have hundreds of call sites.
 *
 * Expected behaviour: the "no callers at all" list is true, and a method kept
 * only so tests can read an internal is marked as such in the source and not
 * counted as app surface it never was.
 */

import { execFileSync } from 'child_process';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');

function report(): string {
  return execFileSync('node', [path.join(REPO, 'scripts/engine-orphan-report.mjs')], {
    cwd: REPO,
    encoding: 'utf8',
  });
}

function section(text: string, heading: string): string[] {
  const start = text.indexOf(heading);
  if (start === -1) throw new Error(`the report has no ${heading} section`);
  // Past the rest of the heading line, which ends in its own `===`.
  const bodyStart = text.indexOf('\n', start);
  const rest = text.slice(bodyStart + 1);
  const end = rest.indexOf('===');
  return (end === -1 ? rest : rest.slice(0, end))
    .split('\n')
    .map((line) => line.trim().split('  ')[0])
    .filter((name) => name.length > 0 && !name.startsWith('Note:'));
}

describe('engine orphan report', () => {
  const text = report();

  it('does not call a constructor uncalled because it is not called with a dot', () => {
    const orphans = section(text, 'NO CALLERS AT ALL');

    expect(orphans).not.toContain('new');
    expect(orphans).not.toContain('in_memory');
    expect(orphans).not.toContain('migration_scripts');
  });

  it('leaves the accessors kept for tests out of the test-only list', () => {
    const testOnly = section(text, 'TEST-ONLY METHODS');

    for (const marked of [
      'section_identity_grave_rows',
      'section_identity_mirror_rows',
      'section_identity_tombstone_ids',
      'section_identity_visible_len',
      'section_config_min_activities',
      'section_config_proximity_threshold',
    ]) {
      expect(testOnly).not.toContain(marked);
    }
  });

  it('still names a method that is genuinely reachable by tests alone', () => {
    // The report is not useful if marking silences it. Something has to be
    // left for the next sweep to look at.
    const testOnly = section(text, 'TEST-ONLY METHODS');

    expect(testOnly.length).toBeGreaterThan(0);
  });
});
