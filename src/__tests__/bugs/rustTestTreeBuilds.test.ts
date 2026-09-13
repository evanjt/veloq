/**
 * Scenario: a commit deleted a `PersistentEngine` method whose only caller was
 * an integration test. `cargo check` of the library passed, the merge battery
 * built only the suites the merge touched, and none of them named the method,
 * so `cargo check --tests` was broken on main and no Rust integration suite
 * could build at all. It was found days later by an agent whose own item needed
 * a test build.
 *
 * Expected behaviour: the tree that holds the tests is built somewhere. The
 * branch pays for it on its own commit when it staged Rust, and the merge pays
 * for it again on the merged tree, where a deletion and its caller can arrive
 * from two different branches.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('the Rust test tree is built by a gate', () => {
  it('is checked on the merged tree, where two branches can combine into a break', () => {
    expect(read('scripts/merge-gates.sh')).toMatch(/cargo check --tests/);
  });

  it('is checked by the branch that staged the Rust, so it fails on its own commit', () => {
    expect(read('.husky/pre-commit')).toMatch(/rust-tests/);
    expect(read('package.json')).toMatch(/"lint:rust-tests"/);
  });

  it('only runs when Rust is staged, so a TypeScript commit pays nothing', () => {
    expect(read('scripts/check-rust-tests.ts')).toMatch(/stagedRustFiles/);
  });
});
