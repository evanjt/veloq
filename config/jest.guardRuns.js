// Refuses a Jest case that runs one of the repository's guards over the whole
// repository.
//
// `npm run audit` runs every guard `scripts/run-guards.mjs` lists, so a case
// that runs one over this checkout and expects it to pass checks nothing the
// audit does not, costs every `npm test` the guard's whole run, and fails a
// red tree twice. A guard is tested against a fixture: a root handed to it, or
// a fixture as its working directory. Three such cases landed after the rule
// was written down, so the rule is here, at the spawn, rather than in a
// sentence. A guard's logic called in-process over the repository, such as
// rendering a generated file and comparing it with the committed one, counts
// as the same run, though this trap sees only spawns.

const childProcess = require('node:child_process');
const { readFileSync } = require('node:fs');
const { basename, isAbsolute, join, relative, resolve } = require('node:path');

const REPO = resolve(__dirname, '..');

/**
 * What the trap keeps on the module it wraps: the functions it wrapped and the
 * runner's list once read. Node's core modules are one object per worker,
 * shared by every suite it runs, and this file is loaded again for each suite,
 * so the state lives on the module and not in this file's scope.
 */
const STATE = Symbol.for('veloq.guardRunTrap');

function state() {
  return (childProcess[STATE] ??= {
    real: { spawnSync: childProcess.spawnSync },
    listed: null,
  });
}

/** The scripts the runner lists and the names it runs them under. */
function runnerGuards() {
  const held = state();
  if (held.listed) return held.listed;
  const run = held.real.spawnSync(
    process.execPath,
    [join(REPO, 'scripts/run-guards.mjs'), '--set', 'all', '--json'],
    { encoding: 'utf8' }
  );
  if (run.status !== 0) throw new Error(`run-guards --json failed: ${run.stderr}`);
  const guards = JSON.parse(run.stdout);
  held.listed = {
    scripts: new Set(guards.flatMap((g) => g.cmd.filter((part) => part.startsWith('scripts/')))),
    names: new Set(guards.map((g) => g.name)),
  };
  return held.listed;
}

/**
 * Whether a guard reads its root from its working directory, `--root` or a
 * positional path. A shell guard reads the working directory through git.
 */
function takesFixtureRoot(script) {
  const held = state();
  held.rooted ??= new Map();
  if (!held.rooted.has(script)) {
    const source = readFileSync(join(REPO, script), 'utf8');
    held.rooted.set(
      script,
      script.endsWith('.sh') ||
        /'--root'|process\.cwd\(|process\.argv(\[2\]|\.slice\(2\))/.test(source)
    );
  }
  return held.rooted.get(script);
}

/** The runner lists guards without running them under these flags. */
const RUNNER_SAFE = ['--json', '--list', '--guards'];
const RUNNER_NPM_SCRIPTS = new Set(['audit', 'audit:guards', 'doctor']);

const inside = (dir, path) => {
  const rel = relative(dir, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** The script `npm run` is asked for, past any flags, or null. */
function npmScript(tokens) {
  if (typeof tokens[0] !== 'string' || basename(tokens[0]) !== 'npm') return null;
  const run = tokens.indexOf('run');
  if (run === -1) return null;
  return tokens.slice(run + 1).find((token) => !token.startsWith('-')) ?? null;
}

/**
 * The guard a command line runs over this repository, or null.
 *
 * `tokens` is the command and its arguments and `cwd` where it starts. A guard
 * is run over the repository when it starts inside it and no argument after
 * the guard names a path outside it, which is what a fixture root is.
 */
function wholeRepoGuardRun(tokens, cwd) {
  const dir = resolve(String(cwd ?? process.cwd()));
  // A command line handed to a shell arrives as one argument, `sh -c 'node
  // scripts/x.mjs'`, so each argument is read word by word.
  const strings = tokens
    .filter((token) => typeof token === 'string')
    .flatMap((token) => token.split(/\s+/))
    .filter(Boolean);
  // Most spawns are git and name nothing under scripts/, so the runner is only
  // asked when one might be a guard.
  const script = npmScript(strings);
  if (script && inside(REPO, dir) && RUNNER_NPM_SCRIPTS.has(script)) return script;
  if (!script && !strings.some((token) => token.includes('scripts/'))) return null;
  const listed = runnerGuards();
  if (script) return listed.names.has(script) ? script : null;
  const runner = strings.findIndex((token) => {
    const path = resolve(dir, token);
    return inside(REPO, path) && relative(REPO, path) === 'scripts/run-guards.mjs';
  });
  if (runner !== -1) {
    return strings.some((token) => RUNNER_SAFE.includes(token)) ? null : strings[runner];
  }
  const at = strings.findIndex((token) => {
    const path = resolve(dir, token);
    return inside(REPO, path) && listed.scripts.has(relative(REPO, path));
  });
  if (at === -1) return null;
  // A guard that roots itself reads this repository from anywhere.
  if (!takesFixtureRoot(relative(REPO, resolve(dir, strings[at])))) return strings[at];
  if (!inside(REPO, dir)) return null;
  const fixture = strings.slice(at + 1).some((token) => isAbsolute(token) && !inside(REPO, token));
  return fixture ? null : strings[at];
}

function refuse(guard) {
  const shown = isAbsolute(guard) ? relative(REPO, guard) : guard;
  throw new Error(
    `${shown} is a guard scripts/run-guards.mjs lists, run over the whole repository from a ` +
      'Jest case. `npm run audit` already runs it there. Hand it a fixture root with --root, ' +
      'or run it with a fixture as its working directory.'
  );
}

/** `file, args?, options?` as a spawn takes them. */
function fileCall(real) {
  return function guarded(file, args, options) {
    const list = Array.isArray(args) ? args : [];
    const opts = Array.isArray(args) ? options : args;
    const guard = wholeRepoGuardRun([file, ...list], opts?.cwd);
    if (guard) refuse(guard);
    return real.apply(this, arguments);
  };
}

/** `command, options?` as a shell command line. */
function shellCall(real) {
  return function guarded(command, options) {
    const tokens = typeof command === 'string' ? command.split(/\s+/).filter(Boolean) : [];
    const opts = typeof options === 'object' ? options : undefined;
    const guard = wholeRepoGuardRun(tokens, opts?.cwd);
    if (guard) refuse(guard);
    return real.apply(this, arguments);
  };
}

/** Carries over what Node hangs on the function, `util.promisify`'s hook. */
function wrapped(real, guarded) {
  for (const symbol of Object.getOwnPropertySymbols(real)) guarded[symbol] = real[symbol];
  return guarded;
}

/** Wraps the spawns on the shared `child_process` module, once per worker. */
function installGuardRunTrap() {
  const held = state();
  if (held.installed) return;
  held.installed = true;
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork']) {
    childProcess[name] = wrapped(childProcess[name], fileCall(childProcess[name]));
  }
  for (const name of ['exec', 'execSync']) {
    childProcess[name] = wrapped(childProcess[name], shellCall(childProcess[name]));
  }
}

module.exports = { installGuardRunTrap };
