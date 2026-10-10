/**
 * Scenario: the OAuth proxy is its own package with its own tsconfig, and only
 * a CI step typechecked it. A narrowing lost inside an async closure landed on
 * main with every local gate green, and would have failed CI on the next push.
 *
 * Expected behaviour: the guard typechecks the proxy as the index holds it,
 * fails on a staged type error and names its line, ignores one left unstaged,
 * and refuses to pass when it cannot find a compiler rather than skipping.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const ROOT = resolve(__dirname, '../../..');
const GUARD = join(ROOT, 'scripts/check-oauth-proxy-types.mjs');
// The root install carries the same compiler. The fixture asks for no ambient
// types, so it needs nothing the proxy's own install adds.
const MODULES = join(ROOT, 'node_modules');

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2020',
    module: 'ES2020',
    lib: ['ES2020'],
    types: [],
    moduleResolution: 'bundler',
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ['src/**/*.ts'],
});

const narrowed = (use: string) => `
declare function clearOwner(owner: string, token: string): Promise<void>;
export async function prune(events: { owner?: string }[], dead: string[]): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const event of events) {
    if (!event.owner) continue;
    ${use}
    pending.push(
      (async () => {
        for (const token of dead) await clearOwner(OWNER, token);
      })()
    );
  }
  await Promise.all(pending);
}
`;

const CLEAN = narrowed('const owner = event.owner;').replace('OWNER', 'owner');
const BROKEN = narrowed('').replace('OWNER', 'event.owner');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function put(root: string, file: string, contents: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), contents);
}

function fixture(worker: string): string {
  const root = mkdtempSync(join(tmpdir(), 'proxy-types-'));
  roots.push(root);
  runGit(['init', '-q'], root);
  put(root, 'oauth-proxy/tsconfig.json', TSCONFIG);
  put(root, 'oauth-proxy/src/worker.ts', worker);
  runGit(['add', '-A'], root);
  return root;
}

function guard(root: string, modules = MODULES): { status: number; output: string } {
  const run = spawnSync('node', [GUARD, '--root', root, '--modules', modules], {
    cwd: root,
    env: gitFreeEnv(),
    encoding: 'utf8',
  });
  return { status: run.status ?? -1, output: `${run.stdout}${run.stderr}` };
}

describe('the OAuth proxy typecheck guard', () => {
  it('passes a proxy that typechecks', () => {
    expect(guard(fixture(CLEAN))).toEqual({ status: 0, output: expect.any(String) });
  });

  it('fails a narrowing lost inside an async closure and names the line', () => {
    const result = guard(fixture(BROKEN));
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/oauth-proxy\/src\/worker\.ts\(\d+,\d+\): error TS2345/);
  });

  it('judges the index, not an unstaged edit', () => {
    const root = fixture(CLEAN);
    put(root, 'oauth-proxy/src/worker.ts', BROKEN);
    expect(guard(root).status).toBe(0);

    runGit(['add', '-A'], root);
    expect(guard(root).status).not.toBe(0);
  });

  it('fails a staged error in a second file', () => {
    const root = fixture(CLEAN);
    put(root, 'oauth-proxy/src/keys.ts', 'export const key: number = "a";\n');
    runGit(['add', '-A'], root);
    const result = guard(root);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('oauth-proxy/src/keys.ts');
  });

  it('refuses rather than passes when no compiler is installed', () => {
    const empty = mkdtempSync(join(tmpdir(), 'proxy-types-empty-'));
    roots.push(empty);
    const result = guard(fixture(CLEAN), empty);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('npm --prefix oauth-proxy ci');
  });
});
