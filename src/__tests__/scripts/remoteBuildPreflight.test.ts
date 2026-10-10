/**
 * Scenario: the remote build host keeps one cargo target cache per tree, each
 * 8 to 20 GB, and nothing removed them, so its root disk filled and every run
 * failed partway through a toolchain install or a package extract.
 *
 * Expected behaviour: before a run, below a free-space floor, the caches idle
 * longer than the age limit are pruned oldest first until free space reaches a
 * high-water mark, never one a running container holds and never the tree
 * being run. When pruning cannot lift free space over the floor the run is
 * refused, naming the largest idle caches, and no container starts. Each tree
 * is keyed on the machine it is sent from as well as its directory name, so
 * two machines with a tree of the same name never share a build directory.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { planPreflight, parseListing } = require('../../../scripts/lib/remote-build-prune.js');

const projectRoot = path.join(__dirname, '../../..');
const GB = 1024 ** 3;
const HOUR = 3600;
const NOW = 1_800_000_000;
const LIMITS = {
  floor: 30 * GB,
  mark: 80 * GB,
  maxIdle: 24 * HOUR,
  now: NOW,
  self: 'orchard-slot2',
};

const slot = (name: string, sizeGb: number, idleHours: number, busy = false) => ({
  name,
  size: sizeGb * GB,
  lastWrite: NOW - idleHours * HOUR,
  busy,
});

describe('planPreflight', () => {
  it('selects nothing while free space is at or above the floor', () => {
    const slots = [slot('orchard-slot7', 20, 100), slot('orchard-slot8', 15, 200)];
    expect(planPreflight({ ...LIMITS, free: 30 * GB, slots })).toEqual({
      prune: [],
      refuse: null,
    });
    expect(planPreflight({ ...LIMITS, free: 200 * GB, slots }).prune).toEqual([]);
  });

  it('prunes idle caches oldest first until the mark is reached, never a busy one', () => {
    const slots = [
      slot('orchard-slot5', 18, 30),
      slot('orchard-slot6', 20, 500, true),
      slot('orchard-slot7', 15, 90),
      slot('orchard-slot8', 12, 48),
      slot('orchard-slot9', 30, 26),
    ];
    const plan = planPreflight({ ...LIMITS, free: 10 * GB, slots });
    // 10 + 15 (90 h) + 12 (48 h) + 18 (30 h) = 55, + 30 (26 h) = 85 reaches 80.
    expect(plan.prune).toEqual([
      'orchard-slot7',
      'orchard-slot8',
      'orchard-slot5',
      'orchard-slot9',
    ]);
    expect(plan.refuse).toBeNull();
  });

  it('stops as soon as the mark is reached', () => {
    const slots = [slot('orchard-slot7', 52, 90), slot('orchard-slot8', 40, 48)];
    expect(planPreflight({ ...LIMITS, free: 29 * GB, slots }).prune).toEqual(['orchard-slot7']);
  });

  it('never selects a cache younger than the age limit or the tree being run', () => {
    const slots = [
      slot('orchard-slot2', 40, 300),
      slot('orchard-slot3', 40, 23),
      slot('orchard-slot4', 5, 25),
    ];
    const plan = planPreflight({ ...LIMITS, free: 20 * GB, slots });
    expect(plan.prune).toEqual(['orchard-slot4']);
    expect(plan.refuse).toMatch(/25\.0 GB free/);
    expect(plan.refuse).toMatch(/orchard-slot3 40\.0 GB idle 23 h/);
    expect(plan.refuse).not.toMatch(/orchard-slot[24] /);
  });

  it('refuses, naming the largest idle caches, when nothing is prunable below the floor', () => {
    const slots = [
      slot('orchard-slot3', 9, 2),
      slot('orchard-slot4', 19, 5),
      slot('orchard-slot5', 40, 1, true),
    ];
    const plan = planPreflight({ ...LIMITS, free: 2 * GB, slots });
    expect(plan.prune).toEqual([]);
    expect(plan.refuse).toMatch(/2\.0 GB free/);
    expect(plan.refuse).toMatch(/orchard-slot4 19\.0 GB idle 5 h/);
    expect(plan.refuse).toMatch(/orchard-slot3 9\.0 GB idle 2 h/);
    expect(plan.refuse!.indexOf('orchard-slot4')).toBeLessThan(
      plan.refuse!.indexOf('orchard-slot3')
    );
    expect(plan.refuse).not.toMatch(/orchard-slot5/);
  });

  it('prunes what it can and still refuses when that leaves free space under the floor', () => {
    const slots = [slot('orchard-slot3', 5, 50), slot('orchard-slot4', 19, 5)];
    const plan = planPreflight({ ...LIMITS, free: 2 * GB, slots });
    expect(plan.prune).toEqual(['orchard-slot3']);
    expect(plan.refuse).toMatch(/7\.0 GB free/);
    expect(plan.refuse).toMatch(/orchard-slot4/);
  });

  it('refuses with an empty listing below the floor', () => {
    const plan = planPreflight({ ...LIMITS, free: 1 * GB, slots: [] });
    expect(plan).toEqual({ prune: [], refuse: expect.stringMatching(/1\.0 GB free/) });
  });
});

describe('parseListing', () => {
  it('reads one tab-separated cache per line in kilobytes and seconds', () => {
    expect(
      parseListing('orchard-slot3\t1048576\t1700000000\t0\norchard-slot4\t2\t5\t1\n\n')
    ).toEqual([
      { name: 'orchard-slot3', size: GB, lastWrite: 1700000000, busy: false },
      { name: 'orchard-slot4', size: 2048, lastWrite: 5, busy: true },
    ]);
  });

  it('refuses a malformed line rather than reading it as an idle cache', () => {
    expect(() => parseListing('orchard-slot3\t\t1700000000\t0\n')).toThrow(/orchard-slot3/);
  });
});

describe('remote-build.sh', () => {
  const host = os.hostname().split('.')[0];

  function run(freeKb: number, listing: string) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-remote-build-'));
    const bin = path.join(root, 'bin');
    const tree = path.join(root, 'orchard-slot2');
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(tree, 'scripts/lib'), { recursive: true });
    for (const file of ['scripts/remote-build.sh', 'scripts/lib/remote-build-prune.js']) {
      fs.copyFileSync(path.join(projectRoot, file), path.join(tree, file));
    }
    fs.chmodSync(path.join(tree, 'scripts/remote-build.sh'), 0o755);
    fs.writeFileSync(path.join(tree, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(root, 'listing'), listing);
    const log = path.join(root, 'calls.log');
    fs.writeFileSync(
      path.join(bin, 'ssh'),
      [
        '#!/bin/sh',
        `printf '%s\\n' "ssh $*" >> "${log}"`,
        'case "$*" in',
        `  *'df -Pk'*) echo ${freeKb} ;;`,
        `  *'du -sk'*) cat "${root}/listing" ;;`,
        'esac',
        'exit 0',
        '',
      ].join('\n'),
      { mode: 0o755 }
    );
    fs.writeFileSync(path.join(bin, 'rsync'), `#!/bin/sh\necho "rsync $*" >> "${log}"\n`, {
      mode: 0o755,
    });
    const result = spawnSync(path.join(tree, 'scripts/remote-build.sh'), [tree, 'cargo test'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        VELOQ_BUILD_HOST: 'buildbox',
      },
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
    fs.rmSync(root, { recursive: true, force: true });
    return { status: result.status, stderr: result.stderr, calls };
  }

  const KB_PER_GB = 1024 * 1024;
  // The script reads the host's clock, so these stay clear of any real time.
  const old = 1;
  const fresh = 4_000_000_000;

  it('starts the container without listing the caches when free space is above the floor', () => {
    const { status, calls } = run(200 * KB_PER_GB, '');
    expect(status).toBe(0);
    expect(calls.some((c) => c.includes('du -sk'))).toBe(false);
    expect(calls.some((c) => c.includes('rm -rf'))).toBe(false);
    expect(calls.filter((c) => c.includes('docker run'))).toHaveLength(1);
  });

  it('keys the build directory and cache on the sending machine and the tree', () => {
    const { calls } = run(200 * KB_PER_GB, '');
    const name = `${host}-orchard-slot2`;
    expect(calls.find((c) => c.startsWith('rsync'))).toContain(`buildbox:builds/${name}/`);
    expect(calls.find((c) => c.includes('docker run'))).toContain(
      `cache/target/${name}:/cache/target`
    );
  });

  it('refuses before the container when nothing is prunable below the floor', () => {
    const listing = `${host}-orchard-slot9\t${19 * KB_PER_GB}\t${fresh}\t0\n`;
    const { status, stderr, calls } = run(2 * KB_PER_GB, listing);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/2\.0 GB free/);
    expect(stderr).toContain(`${host}-orchard-slot9 19.0 GB`);
    expect(calls.some((c) => c.includes('docker run'))).toBe(false);
    expect(calls.some((c) => c.startsWith('rsync'))).toBe(false);
    expect(calls.some((c) => c.includes('rm -rf'))).toBe(false);
  });

  it('removes the selected idle caches and their build directories, then runs', () => {
    const listing = [
      `stale-slot4\t${60 * KB_PER_GB}\t${old}\t0`,
      `stale-slot5\t${60 * KB_PER_GB}\t${old}\t1`,
      `${host}-orchard-slot9\t${19 * KB_PER_GB}\t${fresh}\t0`,
      '',
    ].join('\n');
    const { status, calls } = run(10 * KB_PER_GB, listing);
    expect(status).toBe(0);
    const rm = calls.filter((c) => c.includes('rm -rf'));
    expect(rm).toHaveLength(1);
    expect(rm[0]).toContain('cache/target/stale-slot4');
    expect(rm[0]).toContain('builds/stale-slot4');
    expect(rm[0]).not.toContain('stale-slot5');
    expect(rm[0]).not.toContain('orchard-slot9');
    expect(calls.findIndex((c) => c.includes('rm -rf'))).toBeLessThan(
      calls.findIndex((c) => c.includes('docker run'))
    );
  });
});
