/**
 * Scenario: a widget Kotlin source declares a private helper, a later edit removes one of its
 * parameters, and a call site keeps passing the old argument. The tracked source no longer
 * compiles, and a build that copies it into a fresh Android project fails.
 *
 * Expected behaviour: the guard fails on a call with more arguments than the function declares
 * or fewer than it requires, naming the file and function, and passes when every call fits.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-widget-kotlin-arity.mjs');

function runGuard(root: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      env: gitFreeEnv(),
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

function tree(name: string, kotlin: string): string {
  const root = mkdtempSync(join(tmpdir(), 'widget-kotlin-'));
  roots.push(root);
  const dir = join(root, 'widget/android/java');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), kotlin);
  return root;
}

const DECLARATION = `
object Plot {
  fun draw(
    canvas: Canvas,
    width: Int,
    scale: Float = 1f,
    labels: List<String> = listOf("a", "b"),
  ): Bitmap {
    return render(canvas, width)
  }
}
`;

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('fails when a call passes more arguments than the function declares', () => {
  const root = tree(
    'Chart.kt',
    `${DECLARATION}\nfun use() { Plot.draw(canvas, 10, 2f, emptyList(), false) }\n`
  );
  const { status, output } = runGuard(root);
  expect(status).not.toBe(0);
  expect(output).toContain('Chart.kt');
  expect(output).toContain('draw');
});

it('fails when a call omits a parameter that has no default', () => {
  const root = tree('Chart.kt', `${DECLARATION}\nfun use() { Plot.draw(canvas) }\n`);
  expect(runGuard(root).status).not.toBe(0);
});

it('counts a nested call, a lambda and a string with commas as one argument each', () => {
  const root = tree(
    'Chart.kt',
    `${DECLARATION}\nfun use() { Plot.draw(canvas, max(1, 2), 2f, listOf("x,y", "z").map { a, b -> a }) }\n`
  );
  expect(runGuard(root).status).toBe(0);
});

it('passes when the defaults are left off and when arguments are named', () => {
  const root = tree(
    'Chart.kt',
    `${DECLARATION}\nfun use() {\n  Plot.draw(canvas, 10)\n  Plot.draw(canvas, width = 10, labels = emptyList())\n}\n`
  );
  expect(runGuard(root).status).toBe(0);
});

it('leaves a function declared more than once alone, since the call may pick either overload', () => {
  const root = tree(
    'Chart.kt',
    `fun mix(a: Int): Int = a\nfun mix(a: Int, b: Int): Int = a + b\nfun use() { mix(1, 2) }\n`
  );
  expect(runGuard(root).status).toBe(0);
});
