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

import { spawnSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');

const SCRIPT = path.join(REPO, 'scripts/engine-orphan-report.mjs');

// A root that links the real crate and allowlist, outside the repository so the
// guard runner treats it as a fixture.
function realRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orphans-real-'));
  fs.symlinkSync(path.join(REPO, 'modules'), path.join(dir, 'modules'));
  fs.symlinkSync(path.join(REPO, 'scripts'), path.join(dir, 'scripts'));
  return dir;
}

function report(): string {
  return execFileSync('node', [SCRIPT, '--root', realRoot()], { cwd: REPO, encoding: 'utf8' });
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

describe('engine orphan report --check', () => {
  function fixture(methods: string[], tested: string[], allow: object) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orphans-'));
    const crate = path.join(dir, 'modules/veloqrs/rust/veloqrs');
    fs.mkdirSync(path.join(crate, 'src'), { recursive: true });
    fs.mkdirSync(path.join(crate, 'tests'));
    fs.mkdirSync(path.join(dir, 'scripts'));
    const fns = methods.map((m) => `    pub fn ${m}(&self) {}`).join('\n');
    fs.writeFileSync(path.join(crate, 'src/lib.rs'), `impl PersistentEngine {\n${fns}\n}\n`);
    const calls = tested.map((m) => `    e.${m}();`).join('\n');
    fs.writeFileSync(path.join(crate, 'tests/t.rs'), `fn t(e: E) {\n${calls}\n}\n`);
    const allowFile = path.join(dir, 'scripts/engine-orphan-allowlist.json');
    fs.writeFileSync(allowFile, JSON.stringify(allow));
    return spawnSync('node', [SCRIPT, '--check', '--root', dir], { cwd: REPO, encoding: 'utf8' });
  }

  it('passes when every test-only method is listed', () => {
    const r = fixture(['kept'], ['kept'], { testOnly: { kept: 'read by a test' }, noCallers: {} });
    expect(r.status).toBe(0);
  });

  it('fails on a test-only method missing from the list', () => {
    const r = fixture(['kept', 'added'], ['kept', 'added'], {
      testOnly: { kept: 'read by a test' },
      noCallers: {},
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('added');
  });

  it('fails on a method with no callers that is not listed', () => {
    const r = fixture(['dead'], [], { testOnly: {}, noCallers: {} });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('dead');
  });

  it('fails on a listed method that is no longer present', () => {
    const r = fixture([], [], { testOnly: { gone: 'read by a test' }, noCallers: {} });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('gone');
  });

  it('passes against the real crate and the checked-in list', () => {
    const r = spawnSync('node', [SCRIPT, '--check', '--root', realRoot()], {
      cwd: REPO,
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });
});
