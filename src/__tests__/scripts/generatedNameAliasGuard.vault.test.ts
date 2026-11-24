/**
 * Expected behaviour: the guard fails a generated export renamed on its way out
 * of the veloqrs barrel, runtime or type, and passes the barrel that re-exports
 * generated names unchanged.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-generated-name-aliases.mjs');
const BARREL = 'modules/veloqrs/src/index.ts';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(barrel: string): string {
  const root = mkdtempSync(join(tmpdir(), 'generated-aliases-'));
  roots.push(root);
  const full = join(root, BARREL);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, barrel);
  initFixtureRepo(root);
  return root;
}

function runGuard(root: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      encoding: 'utf8',
      env: gitFreeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

it('fails a renamed runtime export', () => {
  const root = fixture("export { FfiCallKind as CallKind } from './generated/veloqrs';\n");
  const { status, output } = runGuard(root);
  expect(status).toBe(1);
  expect(output).toContain(`${BARREL}:1`);
});

it('fails a renamed type export inside a multi-line list', () => {
  const root = fixture(
    "export type {\n  FfiSwapState,\n  FfiSwapResult as SwapResult,\n} from './generated/veloqrs';\n"
  );
  const { status, output } = runGuard(root);
  expect(status).toBe(1);
  expect(output).toContain(`${BARREL}:3`);
});

it('passes unrenamed exports and an alias of something not generated', () => {
  const root = fixture(
    "export * from './generated/veloqrs';\nexport type StartVerdict = FfiStartOutcome;\nexport { helper as other } from './x';\n"
  );
  expect(runGuard(root).status).toBe(0);
});
