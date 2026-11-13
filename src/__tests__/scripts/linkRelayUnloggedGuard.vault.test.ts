/**
 * Expected behaviour: the guard passes the relay only while its config holds
 * observability off and its source makes no logging call, so the relay never
 * keeps who connected and when. It reads the index, not the disk.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const GUARD = join(resolve(__dirname, '../../..'), 'scripts/check-link-relay-unlogged.mjs');

const UNLOGGED = `name = "relay"
[observability]
enabled = false

[[durable_objects.bindings]]
name = "ROOMS"
`;

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function put(root: string, file: string, contents: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), contents);
}

function fixture(config: string | undefined, worker = 'export {};\n'): string {
  const root = mkdtempSync(join(tmpdir(), 'relay-unlogged-'));
  roots.push(root);
  runGit(['init', '-q'], root);
  put(root, 'link-relay/src/worker.ts', worker);
  if (config !== undefined) put(root, 'link-relay/wrangler.toml', config);
  runGit(['add', '-A'], root);
  return root;
}

function guard(root: string): { status: number; output: string } {
  const run = spawnSync('node', [GUARD, '--root', root], {
    cwd: root,
    env: gitFreeEnv(),
    encoding: 'utf8',
  });
  return { status: run.status ?? -1, output: `${run.stdout}${run.stderr}` };
}

describe('link relay logging guard', () => {
  it('passes a relay with observability off and no logging call', () => {
    expect(guard(fixture(UNLOGGED)).status).toBe(0);
  });

  it('refuses observability switched on', () => {
    const result = guard(fixture(UNLOGGED.replace('enabled = false', 'enabled = true')));
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('[observability] enables logging');
  });

  it('refuses request logs switched on under observability', () => {
    const result = guard(fixture(`${UNLOGGED}\n[observability.logs]\nenabled = true\n`));
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('[observability.logs] enables logging');
  });

  it('refuses a config that leaves observability unset', () => {
    const result = guard(fixture('name = "relay"\n'));
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('[observability] does not say enabled = false');
  });

  it('refuses a missing config', () => {
    const result = guard(fixture(undefined));
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('link-relay/wrangler.toml is not tracked');
  });

  it('refuses a logging call in the relay source and names its line', () => {
    const worker = 'export function f(ip: string) {\n  console.log(ip);\n}\n';
    const result = guard(fixture(UNLOGGED, worker));
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('link-relay/src/worker.ts:2 logs: console.log(ip);');
  });

  it('ignores an enabled line outside observability', () => {
    expect(guard(fixture(`${UNLOGGED}\n[placement]\nenabled = true\n`)).status).toBe(0);
  });

  it('judges the index, not an unstaged edit', () => {
    const root = fixture(UNLOGGED);
    put(root, 'link-relay/wrangler.toml', UNLOGGED.replace('enabled = false', 'enabled = true'));
    expect(guard(root).status).toBe(0);
  });
});
