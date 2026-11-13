/**
 * Scenario: a suite assigns `process.env.TZ` inside Jest, which changes
 * nothing once the worker has read its zone, so the test runs in the
 * machine's zone.
 *
 * Expected behaviour: the guard fails an assignment in a test file, however
 * it is spelled, and leaves reads, comments, non-test files and fixed-offset
 * suites alone.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-test-timezone.mjs');

function runGuard(root?: string): { status: number; output: string } {
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

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'test-timezone-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it.each([
  ['a property assignment', "process.env.TZ = 'Asia/Tokyo';"],
  ['an element assignment', "process.env['TZ'] = 'Asia/Tokyo';"],
  ['a restore of the saved value', 'const saved = 1; process.env.TZ = String(saved);'],
  ['a nullish assignment', "process.env.TZ ??= 'UTC';"],
])('fails %s in a test file', (_label, line) => {
  const root = fixture({ 'src/__tests__/lib/zone.test.ts': `it('x', () => { ${line} });\n` });
  const { status, output } = runGuard(root);
  expect(status).toBe(1);
  expect(output).toContain('src/__tests__/lib/zone.test.ts:1');
});

it('leaves reads, comments, non-test files and fixed-offset suites alone', () => {
  const root = fixture({
    'src/__tests__/lib/read.test.ts':
      "// process.env.TZ = 'UTC' changes nothing\nconst zone = process.env.TZ;\nexpect(zone).toBeDefined();\n",
    'src/__tests__/lib/offset.test.ts':
      "import { atUtcOffset } from '../__shared__/fixedOffsetDate';\natUtcOffset(10, () => new Date());\n",
    'src/shared/setup.ts': "process.env.TZ = 'UTC';\n",
  });
  expect(runGuard(root).status).toBe(0);
});
