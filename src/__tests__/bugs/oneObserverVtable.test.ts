/**
 * Scenario: the native push path Q111 decided on brings a second foreign
 * binding into the app process, beside the JavaScript one.
 *
 * Expected behaviour: the guard refuses it. There is one
 * `init_callback_vtable_engineobserver` slot per process and the last writer
 * wins, so a second installer makes Rust dispatch a JavaScript-registered
 * observer handle through another language's handle map. There is no compile
 * error and no type error: it is a panic on a Rust thread, on a device, in the
 * warm case that works today.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const GUARD = resolve(__dirname, '../../../scripts/lint-one-observer-vtable.mjs');
const SYMBOL = 'uniffi_veloqrs_fn_init_callback_vtable_engineobserver';

function runGuard(root: string): { code: number; output: string } {
  try {
    const output = execFileSync('node', [GUARD, '--root', root], { encoding: 'utf8' });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, output: `${e.stdout}${e.stderr}` };
  }
}

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'vtable-'));
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

describe('the observer vtable guard', () => {
  const made: string[] = [];
  const make = (files: Record<string, string>) => {
    const root = tree(files);
    made.push(root);
    return root;
  };
  afterAll(() => made.forEach((r) => rmSync(r, { recursive: true, force: true })));

  it('passes the tree as it stands, where TypeScript is the only installer', () => {
    const { code } = runGuard(resolve(__dirname, '../../..'));
    expect(code).toBe(0);
  });

  it('refuses generated Kotlin that installs its own vtable', () => {
    const root = make({
      'modules/veloqrs/android/veloqrs.kt': `fun init() { lib.${SYMBOL}(vtable) }`,
    });
    const { code, output } = runGuard(root);
    expect(code).toBe(1);
    expect(output).toContain('modules/veloqrs/android/veloqrs.kt');
  });

  it('refuses generated Swift the same way, since iOS has the same one slot', () => {
    const root = make({ 'modules/veloqrs/ios/veloqrs.swift': `${SYMBOL}(&vtable)` });
    expect(runGuard(root).code).toBe(1);
  });

  it('refuses it in the app module too, not only in the bindings directory', () => {
    const root = make({ 'android/app/src/main/java/Push.kt': `lib.${SYMBOL}(v)` });
    expect(runGuard(root).code).toBe(1);
  });

  it('passes a Kotlin caller that reaches Rust without the callback interface', () => {
    const root = make({
      'android/app/src/main/java/Push.kt': 'external fun nativeFetchAndIndex(id: String): String\n',
    });
    expect(runGuard(root).code).toBe(0);
  });

  it('names the JNI shape to use instead, rather than only refusing', () => {
    const root = make({ 'modules/veloqrs/android/veloqrs.kt': SYMBOL });
    expect(runGuard(root).output).toContain('basemap/jni.rs');
  });
});
