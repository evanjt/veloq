/**
 * Scenario: the reachability audit runs in the husky pre-commit hook, after
 * Prettier, tsc and Jest.
 *
 * Expected behaviour: a clean tree exits 0. A non-zero exit on an untouched
 * checkout costs the whole gate, because every commit then carries
 * `--no-verify`. Colocated `__tests__` siblings are tests, not modules, so
 * nothing importing them is not a defect.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/reachability-audit.mjs');

function runAudit(root?: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', root ? [SCRIPT, '--root', root] : [SCRIPT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'reachability-'));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

describe('reachability audit', () => {
  const roots: string[] = [];

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  const withFixture = (files: Record<string, string>) => {
    const root = fixture(files);
    roots.push(root);
    return root;
  };

  it('exits 0 on this repo, so the pre-commit gate stays usable', () => {
    expect(runAudit().status).toBe(0);
  });

  it('treats a colocated __tests__ sibling as a test, not as a module', () => {
    const root = withFixture({
      'src/app/index.tsx': "import { helper } from '@/lib/helper';\nexport default helper;\n",
      'src/lib/helper.ts': 'export const helper = 1;\n',
      'src/lib/__tests__/helper.test.ts':
        "import { helper } from '../helper';\nit('works', () => expect(helper).toBe(1));\n",
    });

    const { status, output } = runAudit(root);

    expect(status).toBe(0);
    expect(output).not.toContain('helper.test.ts');
  });

  it('still fails on a module nothing reaches', () => {
    const root = withFixture({
      'src/app/index.tsx': "import { helper } from '@/lib/helper';\nexport default helper;\n",
      'src/lib/helper.ts': 'export const helper = 1;\n',
      'src/lib/orphan.ts': 'export const orphan = 2;\n',
    });

    const { status, output } = runAudit(root);

    expect(status).toBe(1);
    expect(output).toContain('src/lib/orphan.ts');
  });

  it('does not fail on a module reached only from a test', () => {
    const root = withFixture({
      'src/app/index.tsx': 'export default 1;\n',
      'src/lib/fixtureData.ts': 'export const rows = [];\n',
      'src/__tests__/rows.test.ts':
        "import { rows } from '@/lib/fixtureData';\nit('works', () => expect(rows).toEqual([]));\n",
    });

    const { status, output } = runAudit(root);

    expect(status).toBe(0);
    expect(output).toContain('Test-only modules');
  });
});
