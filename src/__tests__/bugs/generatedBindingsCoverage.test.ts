/**
 * Scenario: `modules/veloqrs/src/generated/` is committed so a build with no
 * Rust toolchain still has bindings. A local build regenerates them on the way
 * past, so the committed copies are the only ones nobody ever exercises here.
 * Expected behaviour: every foreign-implemented trait the engine takes appears
 * in the committed bindings, so a toolchain-free build can register one.
 *
 * The `EngineObserver` interface and `setObserver` were both absent from the
 * committed bindings for as long as the observer has existed.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../modules/veloqrs');
const OBSERVER_RS = path.join(ROOT, 'rust/veloqrs/src/objects/observer.rs');
const GENERATED_TS = path.join(ROOT, 'src/generated/veloqrs.ts');

function snakeToCamel(name: string): string {
  return name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** The methods of the one `#[uniffi::export(with_foreign)]` trait. */
function observerMethods(): string[] {
  const source = fs.readFileSync(OBSERVER_RS, 'utf8');
  const start = source.indexOf('#[uniffi::export(with_foreign)]');
  expect(start).toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf('\n}\n', start));
  return [...body.matchAll(/^\s*fn\s+(\w+)\s*\(/gm)].map((m) => m[1]);
}

describe('committed UniFFI bindings', () => {
  const generated = fs.readFileSync(GENERATED_TS, 'utf8');

  it('finds the observer trait', () => {
    expect(observerMethods().length).toBeGreaterThan(5);
  });

  it('carries the method that registers a foreign observer', () => {
    expect(generated).toContain('setObserver');
  });

  it.each(observerMethods())('carries the %s callback', (method) => {
    expect(generated).toContain(snakeToCamel(method));
  });
});
