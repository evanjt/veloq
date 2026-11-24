import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const script = join(__dirname, '../../../scripts/lint-unused-exports.mjs');

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'unused-exports-'));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  return root;
}

function runGuard(root: string) {
  const run = spawnSync('node', [script, '--root', root], {
    encoding: 'utf8',
    env: gitFreeEnv(),
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

describe('unused exports guard', () => {
  // Scenario: a barrel keeps a line only while something imports the name through it, so a
  // barrel line, a star re-export and a default export nothing reads are each named.
  it('names an export, a barrel line and a star line that nothing imports', () => {
    const root = fixture({
      'src/lib.ts': `export const used = 1;
export const unusedDecl = 2;
export function viaTest() {}
export default function Thing() {}
`,
      'src/star.ts': `export const starName = 3;\n`,
      'src/barrel.ts': `export { used } from './lib';
export { unusedDecl } from './lib';
export * from './star';
`,
      'src/reader.ts': `import { used } from './barrel';\nvoid used;\n`,
      'src/__tests__/lib.test.ts': `import { viaTest } from '../lib';\nexport const t = viaTest;\n`,
    });
    try {
      const { status, output } = runGuard(root);
      expect(status).toBe(1);
      expect(output).toMatch(/src\/lib\.ts:\d+ unusedDecl/);
      expect(output).toMatch(/src\/barrel\.ts:2 unusedDecl/);
      expect(output).toMatch(/src\/barrel\.ts:3 export \* from '\.\/star'/);
      expect(output).toMatch(/src\/lib\.ts:\d+ default/);
      expect(output).not.toMatch(/ used\n/);
      expect(output).not.toMatch(/viaTest/);
      expect(output).not.toMatch(/src\/barrel\.ts:1 /);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Scenario: a namespace import, a dynamic import and a test import each keep the names they
  // reach, including through a star re-export.
  it('keeps names reached by a namespace import, a dynamic import or a star re-export', () => {
    const root = fixture({
      'src/star.ts': `export const viaNamespace = 1;\nexport const viaDynamic = 2;\n`,
      'src/mid.ts': `export * from './star';\n`,
      'src/ns.ts': `import * as ns from './mid';\nvoid ns;\n`,
      'src/dyn.ts': `void import('./star');\n`,
    });
    try {
      const { status, output } = runGuard(root);
      expect(status).toBe(0);
      expect(output).toMatch(/reachable|OK/);
      expect(output).not.toMatch(/viaNamespace|viaDynamic/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
