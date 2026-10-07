/**
 * Scenario: tooling suites leaked a temp directory per run until /tmp had no
 * inodes left and every gate failed with a disk-full error.
 * Expected behaviour: the guard fails when the Jest setup stops installing the
 * temp directory tracker or removing in an `afterAll`, and when a test makes a
 * path with a shell temp tool.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-test-temp-dirs.mjs');

// Spelled in parts so this file is not itself a hit.
const SHELL_TEMP_TOOL = ['mk', 'temp'].join('');

const SETUP = `const t = require("./jest.tempDirs").installTempDirTracker(require("node:fs"));
afterAll(() => {
  t.removeAll();
});
`;

function runGuard(files: Record<string, string>): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'temp-dirs-guard-'));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
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

describe('test temp directory guard', () => {
  it('passes when the setup installs the tracker', () => {
    expect(runGuard({ 'config/jest.setup.js': SETUP }).status).toBe(0);
  });

  it('fails when the setup no longer installs the tracker', () => {
    const r = runGuard({ 'config/jest.setup.js': 'afterAll(() => {});\n' });
    expect(r.status).toBe(1);
    expect(r.output).toContain('config/jest.setup.js');
  });

  it('fails when the tracker is installed but never removes', () => {
    const r = runGuard({
      'config/jest.setup.js':
        'require("./jest.tempDirs").installTempDirTracker(require("node:fs"));\n',
    });
    expect(r.status).toBe(1);
  });

  it('fails a test that makes a path with the shell tool', () => {
    const r = runGuard({
      'config/jest.setup.js': SETUP,
      'src/__tests__/a.test.ts': `execSync('${SHELL_TEMP_TOOL} -d');\n`,
    });
    expect(r.status).toBe(1);
    expect(r.output).toContain('src/__tests__/a.test.ts:1');
  });

  it('passes a test that uses mkdtempSync', () => {
    const r = runGuard({
      'config/jest.setup.js': SETUP,
      'src/__tests__/a.test.ts': "mkdtempSync(join(tmpdir(), 'x-'));\n",
    });
    expect(r.status).toBe(0);
  });
});
