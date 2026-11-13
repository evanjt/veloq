/**
 * Scenario: a screen pads its bottom by the raw inset, so a control sits on the screen edge on a
 * phone that reports none, or the inset is added twice under a safe area that already took it.
 *
 * Expected behaviour: the guard fails a bottom padding that reads `insets.bottom`, names the file
 * and line, and accepts a padding read from the owner, the owner itself and an inset used for
 * anything but a bottom padding.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-bottom-inset.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'bottom-inset-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
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

const OWNED = 'const style = { paddingBottom: bottomClearance + spacing.md };\n';

it('fails a style that pads its bottom by the inset', () => {
  const root = fixture({
    'src/app/kayak.tsx': OWNED,
    'src/app/canoe.tsx': 'const a = 1;\nconst style = { paddingBottom: insets.bottom + 8 };\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/app/canoe.tsx:2');
  expect(output).not.toContain('kayak.tsx');
});

it('fails a bottom padding prop or variable built from the inset', () => {
  const root = fixture({
    'src/features/paddle/Form.tsx': '<Form bottomPadding={insets.bottom} />\n',
    'src/features/paddle/Bar.tsx': 'const bottomPadding = Math.max(insets.bottom, 4);\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/paddle/Form.tsx:1');
  expect(output).toContain('src/features/paddle/Bar.tsx:1');
});

it('accepts the owner, a padding read from it and an inset used for anything else', () => {
  const root = fixture({
    'src/shared/ui/tabBarClearance.ts': 'const fromEdge = Math.max(insets.bottom, 16);\n',
    'src/app/kayak.tsx': OWNED,
    'src/shared/ui/Bar.tsx': 'const height = 60 + insets.bottom;\n',
  });

  expect(runGuard(root).status).toBe(0);
});
