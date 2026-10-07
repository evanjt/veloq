#!/usr/bin/env node
/**
 * Fail when a Rust test target executes nothing.
 *
 * A target carrying `required-features` that the run does not enable compiles
 * to an empty binary: it prints `running 0 tests` and `ok`, and a gate reading
 * only the exit code passes. `detection_resume` was red on main for an unknown
 * number of days behind that, hiding a resumed detect filing personal records
 * under the wrong direction.
 *
 * Reads `cargo nextest list --message-format json`, which names every target it
 * would run and the tests inside it, so a target that executes nothing is
 * visible before anything runs.
 */

const { execFileSync } = require('child_process');
const path = require('path');

/**
 * Ids of the targets that list no tests.
 *
 * A `bin` target has none by design, so it is exempt. Everything else that
 * lists nothing is either gated on a feature the run did not enable or has no
 * `[[test]]` stanza for cargo to read the gate from.
 */
function emptySuites(list) {
  const suites = list['rust-suites'] || {};
  const ids = Object.keys(suites);
  if (ids.length === 0) {
    throw new Error('the list names no test targets at all, so nothing can be checked');
  }
  return (
    ids
      .filter((id) => suites[id].kind !== 'bin')
      // Keyed by test name, so this is a map to walk and not an array. A target
      // whose tests are all ignored runs nothing, so it counts as empty.
      .filter((id) => !Object.values(suites[id].testcases || {}).some((t) => !t.ignored))
      .sort()
  );
}

function listTargets(cwd, args) {
  const out = execFileSync('cargo', ['nextest', 'list', '--message-format', 'json', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return JSON.parse(out);
}

module.exports = { emptySuites, listTargets };

if (require.main === module) {
  const rust = path.join(__dirname, '..', 'modules', 'veloqrs', 'rust');
  const args = process.argv.slice(2);
  const list = listTargets(
    rust,
    args.length > 0 ? args : ['-p', 'veloqrs', '--features', 'synthetic']
  );
  const empty = emptySuites(list);
  if (empty.length > 0) {
    console.error(`Empty test binary guard: ${empty.length} target(s) execute nothing.`);
    for (const id of empty) console.error(`  ${id}`);
    console.error(
      'A target with no tests reports `ok` in every gate. Give it a [[test]] stanza\n' +
        'naming its required-features, or delete it. A target whose tests are all\n' +
        '#[ignore]d belongs under benches/.'
    );
    process.exit(1);
  }
  const count = Object.keys(list['rust-suites']).length;
  console.log(
    `Empty test binary guard: ${count} targets, ${list['test-count']} tests, none empty.`
  );
}
