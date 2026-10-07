/**
 * Scenario: a screen imports a synchronous generated function from `veloqrs` and
 * calls it directly, so the call blocks the JS thread with no row in the
 * Developer Dashboard's FFI table.
 *
 * Expected behaviour: the guard fails a value import or destructured require of a
 * synchronous generated function in app code, and leaves a type import, an
 * asynchronous export, a test file and the module's own sources alone.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-generated-free-functions.mjs');
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const GENERATED = [
  'export function warmCache(ids: Array<string>): number {',
  '  return 1;',
  '}',
  'export async function pingServer(): Promise<void> {}',
].join('\n');

function runGuard(files: Record<string, string>): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'generated-free-'));
  roots.push(root);
  const all = { 'modules/veloqrs/src/generated/veloqrs.ts': GENERATED, ...files };
  for (const [rel, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

it('fails a value import of a synchronous generated function', () => {
  const { status, output } = runGuard({
    'src/features/a/useWarm.ts': "import { engine, warmCache } from 'veloqrs';\nwarmCache([]);\n",
  });
  expect(status).toBe(1);
  expect(output).toContain('src/features/a/useWarm.ts: warmCache');
});

it('fails an aliased import and a destructured require', () => {
  const { status, output } = runGuard({
    'src/a.ts': "import { warmCache as warm } from 'veloqrs';\n",
    'src/b.ts': "const { warmCache } = require('veloqrs');\n",
  });
  expect(status).toBe(1);
  expect(output).toContain('src/a.ts: warmCache');
  expect(output).toContain('src/b.ts: warmCache');
});

it('fails an import spread over several lines', () => {
  const { status } = runGuard({
    'src/a.ts': "import {\n  engine,\n  warmCache,\n} from 'veloqrs';\n",
  });
  expect(status).toBe(1);
});

it('leaves a type import, an asynchronous export, a test and the engine alone', () => {
  const { status } = runGuard({
    'src/a.ts': "import type { warmCache } from 'veloqrs';\n",
    'src/b.ts': "import { engine, type warmCache } from 'veloqrs';\n",
    'src/c.ts': "import { pingServer } from 'veloqrs';\n",
    'src/__tests__/d.ts': "import { warmCache } from 'veloqrs';\n",
  });
  expect(status).toBe(0);
});
