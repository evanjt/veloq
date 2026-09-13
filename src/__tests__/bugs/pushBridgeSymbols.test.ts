/**
 * Scenario: the Android push handler reaches Rust through hand-written JNI,
 * because uniffi-bindgen cannot generate a Kotlin binding without the observer
 * vtable installer that only one binding per process may run.
 *
 * Expected behaviour: every `native` method the Java bridge declares has the
 * `Java_<package>_<class>_<method>` symbol the JVM will look for, and every such
 * symbol the crate exports has a declaration. A mismatch compiles, links and
 * ships, and fails as an `UnsatisfiedLinkError` on the first push.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RUST = resolve(__dirname, '../../../modules/veloqrs/rust/veloqrs/src');
const JAVA = resolve(__dirname, '../../../modules/veloqrs/android/src/main/java');

function walk(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full, ext);
    return full.endsWith(ext) ? [full] : [];
  });
}

/** Every `Java_pkg_Class_method` the crate exports. */
function rustSymbols(): string[] {
  return walk(RUST, '.rs').flatMap((file) => {
    const body = readFileSync(file, 'utf8');
    return [...body.matchAll(/pub extern "system" fn (Java_[A-Za-z0-9_]+)/g)].map((m) => m[1]);
  });
}

/** The same symbol name for every `native` method a Java class declares. */
function javaSymbols(): string[] {
  return walk(JAVA, '.java').flatMap((file) => {
    const body = readFileSync(file, 'utf8');
    const pkg = /package ([\w.]+);/.exec(body)?.[1];
    const cls = /class (\w+)/.exec(body)?.[1];
    if (!pkg || !cls) return [];
    const prefix = `Java_${pkg.replace(/\./g, '_')}_${cls}`;
    return [...body.matchAll(/\bnative\s+[\w[\]<>.]+\s+(\w+)\s*\(/g)].map(
      (m) => `${prefix}_${m[1]}`
    );
  });
}

describe('the JNI surface the push handler calls', () => {
  it('pairs every declared native method with an exported symbol', () => {
    expect(rustSymbols().sort()).toEqual(javaSymbols().sort());
  });

  it('carries the two the push worker needs, opening the engine and indexing one activity', () => {
    const symbols = rustSymbols();
    expect(symbols).toContain('Java_com_veloq_PushBridge_nativePrepare');
    expect(symbols).toContain('Java_com_veloq_PushBridge_nativeFetchAndIndex');
  });
});
