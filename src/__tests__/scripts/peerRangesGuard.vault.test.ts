/**
 * Scenario: `.npmrc` sets legacy-peer-deps, so an install never refuses a
 * dependency whose peer range the tree does not meet, and a bump that leaves a
 * library on a peer it does not support lands with every gate green.
 * Expected behaviour: the guard fails on an invalid or missing peer the
 * allowlist does not name, passes once the allowlist names it with a reason,
 * and fails on an allowlist entry that no longer matches anything.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../scripts/check-peer-ranges.mjs');

type Locked = Record<string, { version: string; peerDependencies?: Record<string, string> }>;

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function lockfile(declared: Record<string, string>, locked: Locked): string {
  return JSON.stringify({
    name: 'peer-fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'peer-fixture', version: '1.0.0', dependencies: declared },
      ...Object.fromEntries(Object.entries(locked).map(([name, e]) => [`node_modules/${name}`, e])),
    },
  });
}

function runGuard(
  declared: Record<string, string>,
  locked: Locked,
  allow: { kind: string; name: string; requiredBy: string; reason: string }[] = []
) {
  const root = mkdtempSync(join(tmpdir(), 'peer-ranges-guard-'));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'peer-fixture', version: '1.0.0', dependencies: declared })
  );
  writeFileSync(join(root, 'package-lock.json'), lockfile(declared, locked));
  writeFileSync(join(root, '.npmrc'), 'legacy-peer-deps=true\n');
  writeFileSync(join(root, 'allow.json'), JSON.stringify(allow));
  const result = spawnSync('node', [SCRIPT, '--root', root, '--allow', join(root, 'allow.json')], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const declared = { 'example-host': '1.0.0', 'example-peer': '1.0.0' };

it('passes a tree whose peer ranges all hold', () => {
  const result = runGuard(declared, {
    'example-host': { version: '1.0.0', peerDependencies: { 'example-peer': '^1' } },
    'example-peer': { version: '1.0.0' },
  });

  expect(result.output).toContain('check-peer-ranges');
  expect(result.status).toBe(0);
});

it('fails a peer the tree resolves outside its range, naming both packages', () => {
  const result = runGuard(declared, {
    'example-host': { version: '1.0.0', peerDependencies: { 'example-peer': '>= 2.0.0' } },
    'example-peer': { version: '1.0.0' },
  });

  expect(result.status).toBe(1);
  expect(result.output).toContain('example-peer@1.0.0');
  expect(result.output).toContain('example-host');
  expect(result.output).toContain('>= 2.0.0');
});

it('fails a required peer the tree does not hold at all', () => {
  const result = runGuard(
    { 'example-host': '1.0.0' },
    { 'example-host': { version: '1.0.0', peerDependencies: { 'example-absent': '*' } } }
  );

  expect(result.status).toBe(1);
  expect(result.output).toContain('example-absent');
  expect(result.output).toContain('example-host');
});

it('passes a problem the allowlist names with a reason', () => {
  const result = runGuard(
    declared,
    {
      'example-host': { version: '1.0.0', peerDependencies: { 'example-peer': '>= 2.0.0' } },
      'example-peer': { version: '1.0.0' },
    },
    [
      {
        kind: 'invalid',
        name: 'example-peer',
        requiredBy: 'example-host',
        reason: 'the host reads none of the peer at runtime',
      },
    ]
  );

  expect(result.status).toBe(0);
});

it('fails an allowlist entry whose problem is gone, so the list cannot rot', () => {
  const result = runGuard(
    declared,
    {
      'example-host': { version: '1.0.0', peerDependencies: { 'example-peer': '^1' } },
      'example-peer': { version: '1.0.0' },
    },
    [
      {
        kind: 'invalid',
        name: 'example-peer',
        requiredBy: 'example-host',
        reason: 'the host reads none of the peer at runtime',
      },
    ]
  );

  expect(result.status).toBe(1);
  expect(result.output).toContain('example-peer');
});

it('fails an allowlist entry that gives no reason', () => {
  const result = runGuard(
    declared,
    {
      'example-host': { version: '1.0.0', peerDependencies: { 'example-peer': '>= 2.0.0' } },
      'example-peer': { version: '1.0.0' },
    },
    [{ kind: 'invalid', name: 'example-peer', requiredBy: 'example-host', reason: '' }]
  );

  expect(result.status).toBe(1);
});
