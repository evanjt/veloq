/**
 * Which suites a merge has to run, from the files it changes.
 *
 * A merge that does not conflict runs `pre-merge-commit`, which held the lint
 * ceiling and no tests at all. Twice that let through a tree neither branch
 * wrote: a reader change merged against a test written in parallel, and two
 * fixture edits each correct alone. Both were Rust, so a TypeScript-only gate
 * would have sat green through them.
 *
 * The whole suite is not the answer either. Every worktree merges into one
 * checkout under a build lock, and the hook runs inside the merge, so a
 * three-and-a-half minute suite serialises every other session behind it.
 * These are the targets the merge actually touched.
 */

const CRATE = 'modules/veloqrs/rust/veloqrs/';
const RUST_TEST_DIR = `${CRATE}tests/`;

export interface MergeTargets {
  /** `cargo test -p veloqrs --test <name>` for each. */
  rustTests: string[];
  /** Whether the crate's own unit tests have to run. */
  rustLib: boolean;
  /** TypeScript files to hand to `jest --findRelatedTests`. */
  typescript: string[];
}

/** The integration test a path names, or null when it is not one. */
function rustTestName(path: string): string | null {
  if (!path.startsWith(RUST_TEST_DIR) || !path.endsWith('.rs')) return null;
  const rest = path.slice(RUST_TEST_DIR.length);
  // A helper module under `tests/` belongs to whichever suite includes it, so
  // it names no target of its own.
  if (rest.includes('/')) return null;
  return rest.slice(0, -'.rs'.length);
}

/**
 * A merge touching the crate's sources runs its unit tests too: a reader
 * changed on one side and its caller on the other is the shape that got
 * through, and the integration suites alone do not cover it.
 */
function touchesRustSource(path: string): boolean {
  return path.startsWith(`${CRATE}src/`) || path === `${CRATE}Cargo.toml`;
}

function isTypeScript(path: string): boolean {
  return /\.(ts|tsx)$/.test(path) && !path.startsWith('modules/veloqrs/src/generated/');
}

/** The suites to run for a set of changed paths. */
export function mergeTestTargets(changed: string[]): MergeTargets {
  const rustTests = [...new Set(changed.map(rustTestName).filter((n): n is string => n !== null))];
  return {
    rustTests: rustTests.sort(),
    rustLib: changed.some(touchesRustSource),
    typescript: changed.filter(isTypeScript).sort(),
  };
}

/** Whether there is anything at all to run. */
export function hasTargets(targets: MergeTargets): boolean {
  return targets.rustTests.length > 0 || targets.rustLib || targets.typescript.length > 0;
}
