/**
 * Scenario: every worktree merges back through the one checkout, and a merge
 * there holds `pre-merge-commit`'s gates for five to eight minutes. Another
 * session's merge lands inside that window, `update_ref` fails, and the loser
 * leaves its merged tree staged against a `HEAD` that has moved. The next
 * session's merge is then refused for a file neither side touched, so one lost
 * race stops the whole fleet. The first fix built the merge in a throwaway tree
 * and fast-forwarded with no gate, so a candidate carrying a failing suite
 * moved the target before anything judged it.
 *
 * Expected behaviour: `scripts/land-branch.sh` builds the candidate in one
 * persistent landing tree, gates it there, and only then fast-forwards the
 * checkout, so the only step that races is a ref move. A target that moves
 * meanwhile is merged in and the new candidate gated again. One landing holds
 * the tree at a time, and a second is refused at once without touching it.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/land-branch.sh');

const boxes: string[] = [];

function write(root: string, path: string, contents: string, mode = 0o644): void {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents, { mode });
}

/**
 * The fixture's battery. It records the candidate it judged and the base it was
 * handed, can be held at a numbered run until the test lets it go, and fails
 * when the candidate carries `suite-fails`, naming the gate the way the real
 * battery does.
 */
const GATES = `#!/bin/sh
n=$(( $(cat "$LAND_BOX/gate-count" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$LAND_BOX/gate-count"
echo "$(git rev-parse HEAD) \${VELOQ_MERGE_BASE:-none}" >> "$LAND_BOX/gates.log"
for at in \${LAND_PAUSE_GATE:-}; do
  if [ "$at" = "$n" ]; then
    : > "$LAND_BOX/gate-reached.$n"
    while [ ! -e "$LAND_BOX/gate-go.$n" ]; do sleep 0.05; done
  fi
done
if [ -e suite-fails ]; then
  [ -z "\${VELOQ_GATE_REPORT:-}" ] || echo suites > "$VELOQ_GATE_REPORT"
  echo "gate: a suite fails"
  exit 1
fi
if git diff --name-only "\${VELOQ_MERGE_BASE:-HEAD}" "\${VELOQ_MERGE_TEST_REVISION:-HEAD}" | grep -qx 'tracematch-pointer' && [ -e stale-golden ]; then
  [ -z "\${VELOQ_GATE_REPORT:-}" ] || echo suites > "$VELOQ_GATE_REPORT"
  echo "gate: the selected golden fails"
  exit 1
fi
`;

/** Holds the final fast-forward inside the checkout's own hook. */
const POST_MERGE = `#!/bin/sh
if [ -n "\${LAND_PAUSE_FF:-}" ]; then
  : > "$LAND_BOX/ff-reached"
  while [ ! -e "$LAND_BOX/ff-go" ]; do sleep 0.05; done
fi
`;

/** Stands in for provisioning, held until the test lets it go or told to fail. */
const PROVISION = `#!/bin/sh
echo "$1" > "$LAND_BOX/provisioned"
[ -z "\${LAND_PROVISION_FAILS:-}" ] || { echo "provision: no engine to link"; exit 1; }
if [ -n "\${LAND_PAUSE_PROVISION:-}" ]; then
  : > "$LAND_BOX/provision-reached"
  while [ ! -e "$LAND_BOX/provision-go" ]; do sleep 0.05; done
fi
`;

interface Fixture {
  box: string;
  root: string;
  landing: string;
  reservation: string;
}

/**
 * A checkout on `main` with two branches to land, inside a directory of its
 * own so the landing tree beside it is the fixture's. Each branch adds a file
 * of its own, so a merge that lands can be told from one that did not by
 * content rather than by reachability.
 */
function checkoutWithBranch(): Fixture {
  const box = realpathSync(mkdtempSync(join(tmpdir(), 'land-')));
  boxes.push(box);
  const root = join(box, 'veloq');
  mkdirSync(root);
  write(root, 'base.txt', 'base\n');
  write(root, '.gitignore', 'target/\n');
  write(root, 'scripts/merge-gates.sh', GATES, 0o755);
  write(box, 'hooks/post-merge', POST_MERGE, 0o755);
  write(box, 'provision.sh', PROVISION, 0o755);
  runGit(['init', '-q', '-b', 'main'], root);
  runGit(['config', 'core.hooksPath', join(box, 'hooks')], root);
  runGit(['add', '-A'], root);
  runGit(['commit', '-qm', 'base'], root);

  for (const [branch, file] of [
    ['audit/thing', 'landed.txt'],
    ['audit/other', 'other.txt'],
  ]) {
    runGit(['checkout', '-q', '-b', branch, 'main'], root);
    write(root, file, `from ${branch}\n`);
    runGit(['add', '-A'], root);
    runGit(['commit', '-qm', `the branch ${branch}`], root);
  }
  runGit(['checkout', '-q', 'main'], root);
  const landing = join(box, 'veloq-landing');
  return { box, root, landing, reservation: `${landing}.owner` };
}

function commitOn(root: string, path: string, contents: string, message: string): string {
  write(root, path, contents);
  runGit(['add', path], root);
  runGit(['commit', '-qm', message], root);
  return runGit(['rev-parse', 'HEAD'], root).trim();
}

/** The lander's switches and the fixture's barriers, laid over `gitFreeEnv`. */
function switches(fx: Fixture, extra: Record<string, string>): Record<string, string> {
  return {
    VELOQ_LAND_ATTEMPTS: '2',
    VELOQ_LAND_SLEEP: '0',
    LAND_BOX: fx.box,
    ...extra,
  };
}

/** Both streams, so a warning printed on a landing that succeeds is seen. */
function land(
  fx: Fixture,
  branch: string,
  extra: Record<string, string> = {}
): { status: number; output: string } {
  const result = spawnSync('bash', [SCRIPT, branch], {
    cwd: fx.root,
    env: { ...gitFreeEnv(), ...switches(fx, extra) },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

interface Running {
  child: ChildProcess;
  done: Promise<{ status: number | null; signal: NodeJS.Signals | null; output: string }>;
}

/** A lander left running, in a process group of its own so it can be interrupted whole. */
function startLanding(fx: Fixture, branch: string, extra: Record<string, string>): Running {
  const child = spawn('bash', [SCRIPT, branch], {
    cwd: fx.root,
    env: { ...gitFreeEnv(), ...switches(fx, extra) },
    detached: true,
  });
  let output = '';
  child.stdout?.on('data', (chunk) => (output += chunk));
  child.stderr?.on('data', (chunk) => (output += chunk));
  const done = new Promise<{
    status: number | null;
    signal: NodeJS.Signals | null;
    output: string;
  }>((resolve) => child.on('close', (status, signal) => resolve({ status, signal, output })));
  return { child, done };
}

/** Wait for a barrier file the paused lander writes. Bounded only so a broken lander fails. */
async function reached(path: string, running?: Running): Promise<void> {
  let exited = false;
  running?.done.then(() => (exited = true));
  for (let i = 0; i < 1000; i++) {
    if (existsSync(path)) return;
    if (exited)
      throw new Error(`the lander exited before ${path}: ${(await running!.done).output}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`never reached ${path}`);
}

function release(fx: Fixture, barrier: string): void {
  writeFileSync(join(fx.box, barrier), '');
}

function gated(fx: Fixture): { candidate: string; base: string }[] {
  const log = join(fx.box, 'gates.log');
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [candidate, base] = line.split(' ');
      return { candidate, base };
    });
}

const head = (cwd: string) => runGit(['rev-parse', 'HEAD'], cwd).trim();

afterAll(() => {
  for (const box of boxes) rmSync(box, { recursive: true, force: true });
});

describe('landing a branch', () => {
  it('lands it, and the content is there rather than merely reachable', () => {
    const fx = checkoutWithBranch();

    const { status, output } = land(fx, 'audit/thing');

    expect(status).toBe(0);
    expect(output).toContain('landed audit/thing');
    expect(readFileSync(join(fx.root, 'landed.txt'), 'utf8')).toBe('from audit/thing\n');
  });

  /**
   * The defect this exists for. `git merge` refuses while the index differs
   * from `HEAD` for any path it would check out, so one session's staged files
   * stopped every other session's merge for about ninety minutes on
   * 2026-09-15.
   */
  it('lands over another session’s staged work, and leaves it staged', () => {
    const fx = checkoutWithBranch();
    write(fx.root, 'someone-elses.txt', 'mid-merge, not mine\n');
    runGit(['add', 'someone-elses.txt'], fx.root);
    write(fx.root, 'base.txt', 'an unsaved edit, not mine\n');

    const { status } = land(fx, 'audit/thing');

    expect(status).toBe(0);
    expect(readFileSync(join(fx.root, 'landed.txt'), 'utf8')).toBe('from audit/thing\n');
    expect(runGit(['diff', '--cached', '--name-only'], fx.root).trim()).toBe('someone-elses.txt');
    expect(readFileSync(join(fx.root, 'base.txt'), 'utf8')).toBe('an unsaved edit, not mine\n');
  });

  it('refuses a branch that does not exist rather than half landing one', () => {
    const fx = checkoutWithBranch();

    const { status, output } = land(fx, 'audit/never-was');

    expect(status).not.toBe(0);
    expect(output).toMatch(/audit\/never-was/);
    expect(runGit(['log', '--oneline', '-1'], fx.root)).toContain('base');
  });

  /** A conflict is the author's to resolve, and must leave the checkout alone. */
  it('leaves the checkout untouched when the merge conflicts', () => {
    const fx = checkoutWithBranch();
    const before = commitOn(fx.root, 'landed.txt', 'from main instead\n', 'main writes it');

    const { status, output } = land(fx, 'audit/thing');

    expect(status).not.toBe(0);
    expect(output).toMatch(/conflict/i);
    expect(head(fx.root)).toBe(before);
    expect(runGit(['status', '--porcelain'], fx.root).trim()).toBe('');
    expect(runGit(['status', '--porcelain'], fx.landing).trim()).toBe('');
    expect(existsSync(fx.reservation)).toBe(false);
  });
});

describe('the candidate is gated before the target moves', () => {
  it('gates the very candidate it lands, handed the target it merged onto', () => {
    const fx = checkoutWithBranch();
    const before = head(fx.root);

    const { status } = land(fx, 'audit/thing');

    expect(status).toBe(0);
    expect(gated(fx)).toEqual([{ candidate: head(fx.root), base: before }]);
  });

  it('leaves the target where it was when the candidate fails a gate', () => {
    const fx = checkoutWithBranch();
    runGit(['checkout', '-q', 'audit/thing'], fx.root);
    commitOn(fx.root, 'suite-fails', 'yes\n', 'the branch breaks a suite');
    runGit(['checkout', '-q', 'main'], fx.root);
    const before = head(fx.root);

    const { status, output } = land(fx, 'audit/thing');

    expect(status).not.toBe(0);
    expect(head(fx.root)).toBe(before);
    expect(existsSync(join(fx.root, 'landed.txt'))).toBe(false);
    expect(output).toContain('gate: a suite fails');
    expect(output).toMatch(/main was not moved/);
    expect(output).toMatch(/pass on main at [0-9a-f]+, so this branch brings the failure/);
    expect(existsSync(fx.reservation)).toBe(false);
  });

  it('says so when the failing gate fails on the target as well', () => {
    const fx = checkoutWithBranch();
    const before = commitOn(fx.root, 'suite-fails', 'yes\n', 'main already breaks a suite');
    const short = runGit(['rev-parse', '--short', 'HEAD'], fx.root).trim();

    const { status, output } = land(fx, 'audit/thing');

    expect(status).not.toBe(0);
    expect(head(fx.root)).toBe(before);
    expect(output).toContain(`already on main at ${short}, not this branch's`);
  });

  it('selects the candidate’s pointer gate when judging an already stale target', () => {
    const fx = checkoutWithBranch();
    const before = commitOn(fx.root, 'stale-golden', 'yes\n', 'main has a stale golden');
    runGit(['checkout', '-q', 'audit/thing'], fx.root);
    commitOn(fx.root, 'tracematch-pointer', 'new pin\n', 'move the pointer');
    runGit(['checkout', '-q', 'main'], fx.root);

    const { status, output } = land(fx, 'audit/thing');

    expect(status).not.toBe(0);
    expect(head(fx.root)).toBe(before);
    expect(output).toContain('gate: the selected golden fails');
    expect(output).toMatch(/suites gate fails already on main at [0-9a-f]+/);
  });

  it('gates the candidate again when the target moves while it is gated, and lands that one', async () => {
    const fx = checkoutWithBranch();
    const a = startLanding(fx, 'audit/thing', { LAND_PAUSE_GATE: '1' });
    await reached(join(fx.box, 'gate-reached.1'), a);

    const moved = commitOn(fx.root, 'moved.txt', 'main moved\n', 'main moves meanwhile');
    release(fx, 'gate-go.1');
    const { status, output } = await a.done;

    expect(output).toContain('landed audit/thing');
    expect(status).toBe(0);
    const runs = gated(fx);
    expect(runs).toHaveLength(2);
    expect(runs[1].base).toBe(moved);
    expect(head(fx.root)).toBe(runs[1].candidate);
    expect(readFileSync(join(fx.root, 'moved.txt'), 'utf8')).toBe('main moved\n');
    expect(readFileSync(join(fx.root, 'landed.txt'), 'utf8')).toBe('from audit/thing\n');
  });

  it('refuses when the target moves into a failure while the candidate is gated', async () => {
    const fx = checkoutWithBranch();
    const a = startLanding(fx, 'audit/thing', { LAND_PAUSE_GATE: '1' });
    await reached(join(fx.box, 'gate-reached.1'), a);

    const moved = commitOn(fx.root, 'suite-fails', 'yes\n', 'main moves into a failure');
    release(fx, 'gate-go.1');
    const { status } = await a.done;

    expect(status).not.toBe(0);
    expect(head(fx.root)).toBe(moved);
    expect(existsSync(join(fx.root, 'landed.txt'))).toBe(false);
  });
});

describe('the persistent landing tree', () => {
  it('is one worktree beside the checkout, kept between landings with its build state', () => {
    const fx = checkoutWithBranch();
    expect(land(fx, 'audit/thing').status).toBe(0);
    write(fx.landing, 'target/debug/warm', 'compiled\n');

    const second = land(fx, 'audit/other');

    expect(second.status).toBe(0);
    expect(readFileSync(join(fx.landing, 'target/debug/warm'), 'utf8')).toBe('compiled\n');
    expect(runGit(['worktree', 'list', '--porcelain'], fx.root)).toContain(
      `worktree ${fx.landing}\n`
    );
    expect(existsSync(fx.reservation)).toBe(false);
  });

  it('is reset to the target before each candidate, whatever the last landing left in it', () => {
    const fx = checkoutWithBranch();
    expect(land(fx, 'audit/thing').status).toBe(0);
    write(fx.landing, 'base.txt', 'left behind\n');
    write(fx.landing, 'stray.txt', 'left behind\n');

    expect(land(fx, 'audit/other').status).toBe(0);

    expect(readFileSync(join(fx.root, 'base.txt'), 'utf8')).toBe('base\n');
    expect(existsSync(join(fx.root, 'stray.txt'))).toBe(false);
    expect(runGit(['show', 'HEAD:base.txt'], fx.root)).toBe('base\n');
  });

  it('runs no gate and leaves the target alone when provisioning fails, then lands once fixed', () => {
    const fx = checkoutWithBranch();
    const before = head(fx.root);
    const provision = { VELOQ_LAND_PROVISION: join(fx.box, 'provision.sh') };

    const failed = land(fx, 'audit/thing', { ...provision, LAND_PROVISION_FAILS: '1' });

    expect(failed.status).not.toBe(0);
    expect(failed.output).toContain('provision: no engine to link');
    expect(head(fx.root)).toBe(before);
    expect(gated(fx)).toEqual([]);
    expect(existsSync(fx.reservation)).toBe(false);

    const fixed = land(fx, 'audit/thing', provision);

    expect(fixed.status).toBe(0);
    expect(readFileSync(join(fx.box, 'provisioned'), 'utf8').trim()).toBe(fx.landing);
  });
});

describe('one landing holds the tree at a time', () => {
  /** What a refused contender must have left exactly as it found it. */
  function snapshot(fx: Fixture) {
    return {
      target: head(fx.root),
      landing: head(fx.landing),
      owner: readFileSync(join(fx.reservation, 'owner'), 'utf8'),
      gated: gated(fx).length,
    };
  }

  function expectRefused(fx: Fixture, holder: Running, held: ReturnType<typeof snapshot>) {
    const contender = land(fx, 'audit/other');

    expect(contender.status).not.toBe(0);
    expect(contender.output).toContain(fx.reservation);
    expect(contender.output).toContain(`pid=${holder.child.pid}`);
    expect(contender.output).toContain('branch=audit/thing');
    expect(contender.output).not.toContain('landed audit/other');
    expect(snapshot(fx)).toEqual(held);
  }

  async function landsWhatItGated(fx: Fixture, holder: Running) {
    const { status, output } = await holder.done;
    expect(output).toContain('landed audit/thing');
    expect(status).toBe(0);
    expect(head(fx.root)).toBe(gated(fx).at(-1)?.candidate);
    expect(existsSync(join(fx.root, 'other.txt'))).toBe(false);
    expect(existsSync(fx.reservation)).toBe(false);
  }

  it('refuses a second lander while the first is provisioning', async () => {
    const fx = checkoutWithBranch();
    const a = startLanding(fx, 'audit/thing', {
      VELOQ_LAND_PROVISION: join(fx.box, 'provision.sh'),
      LAND_PAUSE_PROVISION: '1',
    });
    await reached(join(fx.box, 'provision-reached'), a);

    expectRefused(fx, a, snapshot(fx));
    expect(gated(fx)).toEqual([]);

    release(fx, 'provision-go');
    await landsWhatItGated(fx, a);
  });

  it('refuses a second lander while the first is gating its candidate', async () => {
    const fx = checkoutWithBranch();
    const a = startLanding(fx, 'audit/thing', { LAND_PAUSE_GATE: '1' });
    await reached(join(fx.box, 'gate-reached.1'), a);

    expectRefused(fx, a, snapshot(fx));

    release(fx, 'gate-go.1');
    await landsWhatItGated(fx, a);
    expect(gated(fx)).toHaveLength(1);
  });

  it('refuses a second lander while the first gates again after the target moved', async () => {
    const fx = checkoutWithBranch();
    const a = startLanding(fx, 'audit/thing', { LAND_PAUSE_GATE: '1 2' });
    await reached(join(fx.box, 'gate-reached.1'), a);
    commitOn(fx.root, 'moved.txt', 'main moved\n', 'main moves meanwhile');
    release(fx, 'gate-go.1');
    await reached(join(fx.box, 'gate-reached.2'), a);

    expectRefused(fx, a, snapshot(fx));

    release(fx, 'gate-go.2');
    await landsWhatItGated(fx, a);
    expect(gated(fx)).toHaveLength(2);
  });

  it('refuses a second lander during the first one’s final fast-forward', async () => {
    const fx = checkoutWithBranch();
    const a = startLanding(fx, 'audit/thing', { LAND_PAUSE_FF: '1' });
    await reached(join(fx.box, 'ff-reached'), a);

    expectRefused(fx, a, snapshot(fx));

    release(fx, 'ff-go');
    await landsWhatItGated(fx, a);
  });

  it('gives the tree up when interrupted, once its gate has stopped, and keeps the build state', async () => {
    const fx = checkoutWithBranch();
    expect(land(fx, 'audit/other').status).toBe(0);
    write(fx.landing, 'target/debug/warm', 'compiled\n');
    const before = head(fx.root);
    const a = startLanding(fx, 'audit/thing', { LAND_PAUSE_GATE: '2' });
    await reached(join(fx.box, 'gate-reached.2'), a);

    process.kill(-a.child.pid!, 'SIGTERM');
    const interrupted = await a.done;

    expect(interrupted.status).not.toBe(0);
    expect(head(fx.root)).toBe(before);
    expect(existsSync(fx.reservation)).toBe(false);

    const next = land(fx, 'audit/thing');

    expect(next.status).toBe(0);
    expect(readFileSync(join(fx.root, 'landed.txt'), 'utf8')).toBe('from audit/thing\n');
    expect(readFileSync(join(fx.landing, 'target/debug/warm'), 'utf8')).toBe('compiled\n');
  });
});

/**
 * A reservation outlives its owner only when the owner could not run its own
 * cleanup. Whether anything still works in the tree cannot be read off a pid
 * or an age, so nothing takes one over: a person checks and removes it.
 */
describe('a reservation left behind', () => {
  it('refuses while it has no owner record, keeps it, and lands once it is removed by hand', () => {
    const fx = checkoutWithBranch();
    mkdirSync(fx.reservation);
    const before = head(fx.root);

    const { status, output } = land(fx, 'audit/thing');

    expect(status).not.toBe(0);
    expect(output).toContain(fx.reservation);
    expect(output).toMatch(/no owner record/);
    expect(output).toContain(`rm -r ${fx.reservation}`);
    expect(existsSync(fx.reservation)).toBe(true);
    expect(head(fx.root)).toBe(before);
    expect(gated(fx)).toEqual([]);

    rmSync(fx.reservation, { recursive: true });

    expect(land(fx, 'audit/thing').status).toBe(0);
  });

  it('refuses one whose owner has exited, rather than guessing it is free', () => {
    const fx = checkoutWithBranch();
    mkdirSync(fx.reservation);
    const record = 'pid=4194303\nhost=elsewhere\nbranch=audit/gone\ntarget=main\n';
    writeFileSync(join(fx.reservation, 'owner'), record);

    const { status, output } = land(fx, 'audit/thing');

    expect(status).not.toBe(0);
    expect(output).toContain('pid=4194303');
    expect(output).toContain('branch=audit/gone');
    expect(readFileSync(join(fx.reservation, 'owner'), 'utf8')).toBe(record);
    expect(existsSync(fx.landing)).toBe(false);
  });
});

/**
 * The other half of the defect. The loser of a ref race leaves no `MERGE_HEAD`,
 * so `git merge --abort` refuses and `git status` reads like somebody's work in
 * progress. Two sessions broadcast to the fleet hunting the holder before the
 * cause was found.
 */
describe('a checkout carrying a stranded merge', () => {
  it('is named, with what it holds and how it is cleared', () => {
    const fx = checkoutWithBranch();
    // The wreckage: the same path the branch writes, staged against a HEAD
    // that has no merge in progress, so the fast-forward is refused.
    write(fx.root, 'landed.txt', 'somebody else half landed this\n');
    runGit(['add', 'landed.txt'], fx.root);

    const { status, output } = land(fx, 'audit/thing');

    expect(status).not.toBe(0);
    expect(output).toContain('staged tree with no merge in progress');
    expect(output).toContain('landed.txt');
    expect(output).toContain('git reset --hard HEAD');
    expect(output).toContain('Do not clear another session');
    expect(existsSync(fx.reservation)).toBe(false);
  });
});

/**
 * Another session's plain `git merge` stopped on a conflict leaves `MERGE_HEAD`
 * in the checkout, and git refuses every merge until it is concluded. The
 * script retried for about seventeen minutes, then blamed the target moving,
 * which steers an agent towards aborting or finishing a merge it does not own.
 */
describe('a checkout with another session’s merge in progress', () => {
  function checkoutMidMerge(): Fixture {
    const fx = checkoutWithBranch();
    const root = fx.root;
    runGit(['checkout', '-q', '-b', 'audit/theirs'], root);
    write(root, 'base.txt', 'theirs\n');
    runGit(['commit', '-qam', 'their side of the conflict'], root);
    runGit(['checkout', '-q', 'main'], root);
    write(root, 'base.txt', 'main\n');
    runGit(['commit', '-qam', 'main side of the conflict'], root);
    expect(() => runGit(['merge', '-q', 'audit/theirs'], root)).toThrow();
    return fx;
  }

  it('refuses at once, naming the merge and its age, and leaves it alone', () => {
    const fx = checkoutMidMerge();
    const mergeHead = runGit(['rev-parse', 'MERGE_HEAD'], fx.root).trim();

    const { status, output } = land(fx, 'audit/thing');

    expect(status).not.toBe(0);
    expect(output).toContain('their side of the conflict');
    expect(output).toMatch(/MERGE_HEAD/);
    expect(output).toMatch(/\d+ s old|\d+ min old/);
    expect(output).toMatch(/not this session.s to finish or abort/);
    expect(output).not.toContain('moved under every attempt');
    expect(output).not.toContain('You have not concluded your merge');
    expect(runGit(['rev-parse', 'MERGE_HEAD'], fx.root).trim()).toBe(mergeHead);
    expect(gated(fx)).toEqual([]);
  });
});

/**
 * A worktree's hooks live in the git-ignored `.husky/_`, so a tree where
 * `npm run prepare` never ran commits with no gates at all. Landing is the one
 * step every branch passes, so it is where the lander hears about it.
 */
describe('a branch whose worktree has no hooks installed', () => {
  function checkoutWithWorktree(): { fx: Fixture; tree: string } {
    const fx = checkoutWithBranch();
    const tree = join(fx.box, 'veloq-thing');
    runGit(['worktree', 'add', '-q', tree, 'audit/thing'], fx.root);
    return { fx, tree };
  }

  it('warns, naming the worktree and npm run prepare, and still lands', () => {
    const { fx, tree } = checkoutWithWorktree();

    const { status, output } = land(fx, 'audit/thing');

    expect(status).toBe(0);
    expect(output).toContain(tree);
    expect(output).toContain('npm run prepare');
    expect(output).toMatch(/no gates/);
    expect(readFileSync(join(fx.root, 'landed.txt'), 'utf8')).toBe('from audit/thing\n');
  });

  it('says nothing when the worktree has its hooks', () => {
    const { fx, tree } = checkoutWithWorktree();
    mkdirSync(join(tree, '.husky/_'), { recursive: true });

    const { status, output } = land(fx, 'audit/thing');

    expect(status).toBe(0);
    expect(output).not.toContain('npm run prepare');
  });

  it('says nothing when no worktree has the branch checked out', () => {
    const fx = checkoutWithBranch();

    const { output } = land(fx, 'audit/thing');

    expect(output).not.toContain('npm run prepare');
  });
});

/**
 * Scenario: a landed branch carries no work of its own, but its ref used to
 * stay for ever, so `git branch` listed hundreds of them beside the few that
 * still hold work.
 *
 * Expected behaviour: a landing that succeeds deletes the branch with `-d`, so
 * git itself refuses an unmerged one. A branch a worktree still holds is kept
 * and the commands to finish with it are printed. A landing that fails deletes
 * nothing.
 */
describe('the ref of a landed branch', () => {
  function branches(root: string): string[] {
    return runGit(['branch', '--format=%(refname:short)'], root).trim().split('\n');
  }

  it('is deleted once the landing succeeds', () => {
    const fx = checkoutWithBranch();

    const { status } = land(fx, 'audit/thing');

    expect(status).toBe(0);
    expect(branches(fx.root)).toEqual(['audit/other', 'main']);
  });

  it('is kept, with the commands to finish, while a worktree holds it', () => {
    const fx = checkoutWithBranch();
    const tree = join(fx.box, 'veloq-thing');
    runGit(['worktree', 'add', '-q', tree, 'audit/thing'], fx.root);

    const { status, output } = land(fx, 'audit/thing');

    expect(status).toBe(0);
    expect(branches(fx.root)).toContain('audit/thing');
    expect(output).toContain(`git worktree remove ${tree}`);
    expect(output).toContain('git branch -d audit/thing');
  });

  it('is kept when the merge conflicts', () => {
    const fx = checkoutWithBranch();
    commitOn(fx.root, 'landed.txt', 'from main instead\n', 'main writes the same file');

    const { status } = land(fx, 'audit/thing');

    expect(status).not.toBe(0);
    expect(branches(fx.root)).toContain('audit/thing');
  });

  it('is kept when the fast-forward is refused', () => {
    const fx = checkoutWithBranch();
    write(fx.root, 'landed.txt', 'somebody else half landed this\n');
    runGit(['add', 'landed.txt'], fx.root);

    const { status } = land(fx, 'audit/thing');

    expect(status).not.toBe(0);
    expect(branches(fx.root)).toContain('audit/thing');
  });
});
