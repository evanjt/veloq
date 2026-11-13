/**
 * Scenario: a Rust test that passes the process-wide engine install to a
 * stamped write without holding the serial lock is refused whenever a parallel
 * test moves the install, so it fails only in filtered or loaded runs.
 *
 * Expected behaviour: the guard fails a `#[test]` under the veloqrs `src` tree
 * whose body reads `engine_install()` and takes no `serial_global_state`, and
 * accepts one that takes it directly, by path or through a `use ... as` alias.
 * Helpers that are not tests and mentions in comments or strings are left alone.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-rust-test-serial.mjs');
const SRC = 'modules/veloqrs/rust/veloqrs/src';

function runGuard(root?: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', root ? [SCRIPT, '--root', root] : [SCRIPT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'rust-test-serial-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, SRC, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('rust test serial guard', () => {
  it('refuses a test that reads the install without the serial lock', () => {
    const root = fixture({
      'naming.rs': `#[test]
fn names_a_route() {
    let install = crate::persistence::engine_install();
    worker_write(install, |e| e.rename());
}
`,
    });
    const { status, output } = runGuard(root);
    expect(status).toBe(1);
    expect(output).toContain('naming.rs');
    expect(output).toContain('names_a_route');
  });

  it('accepts a test that takes the lock directly, by path or by name', () => {
    const root = fixture({
      'direct.rs': `#[test]
fn by_path() {
    let _serial = crate::test_globals::serial_global_state();
    let install = crate::persistence::engine_install();
    worker_write(install, |e| e.rename());
}

#[test]
fn by_name() {
    let _serial = serial_global_state();
    let install = engine_install();
    worker_write(install, |e| e.rename());
}
`,
    });
    expect(runGuard(root).status).toBe(0);
  });

  it('accepts a test that takes the lock through a use alias', () => {
    const root = fixture({
      'aliased.rs': `use crate::test_globals::{
    seeded_global_engine,
    serial_global_state as serial,
};

#[test]
fn aliased() {
    let _g = serial();
    let install = crate::persistence::engine_install();
    worker_write(install, |e| e.rename());
}
`,
    });
    expect(runGuard(root).status).toBe(0);
  });

  it('does not let one test borrow the lock of the test beside it', () => {
    const root = fixture({
      'neighbours.rs': `#[test]
fn guarded() {
    let _serial = serial_global_state();
}

#[test]
fn unguarded() {
    let install = engine_install();
    worker_write(install, |e| e.rename());
}
`,
    });
    const { status, output } = runGuard(root);
    expect(status).toBe(1);
    expect(output).toContain('unguarded');
    expect(output).not.toContain('guarded()');
  });

  it('leaves helpers, comments and strings alone', () => {
    const root = fixture({
      'helpers.rs': `fn note_stored(n: u32) {
    note_stored_for(crate::persistence::engine_install(), n);
}

#[test]
fn mentions_it() {
    // reads engine_install() only in prose
    let text = "engine_install()";
    assert!(!text.is_empty());
}
`,
    });
    expect(runGuard(root).status).toBe(0);
  });
});
