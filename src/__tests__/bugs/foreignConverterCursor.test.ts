/**
 * Scenario: `FfiConverterObjectWithCallbacks` overrides `lower` and `lift` to
 * consult the handle map a JavaScript implementation lives in, and does not
 * override `writeIntoCursor`. Every container and every record field goes
 * through the cursor, which falls to `FfiConverterObject.lowerHandle` and
 * throws "Cannot lower this object to a pointer". The generator emits it
 * without complaint, and the engine observer spent five days withheld on
 * every launch because `setObserver` took an optional.
 *
 * Expected behaviour: the guard refuses a generated binding that puts a
 * foreign-implemented converter anywhere but `lower`, `lift`, `drop` and
 * `clone`, so the next one fails the audit gate rather than the phone.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const GUARD = resolve(__dirname, '../../../scripts/lint-foreign-converter-cursor.mjs');
const DECLARE = `const FfiConverterTypeEngineObserver = new FfiConverterObjectWithCallbacks(
  uniffiTypeEngineObserverImplObjectFactory,
);`;

function runGuard(root: string): { code: number; output: string } {
  try {
    const output = execFileSync('node', [GUARD, '--root', root], { encoding: 'utf8' });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, output: `${e.stdout}${e.stderr}` };
  }
}

describe('the foreign converter cursor guard', () => {
  const made: string[] = [];
  const generated = (body: string) => {
    const root = mkdtempSync(join(tmpdir(), 'cursor-'));
    made.push(root);
    const dir = join(root, 'modules/veloqrs/src/generated');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'veloqrs.ts'), `${DECLARE}\n${body}\n`);
    return runGuard(root);
  };
  afterAll(() => made.forEach((r) => rmSync(r, { recursive: true, force: true })));

  it('passes the bindings as they stand', () => {
    const { code } = runGuard(resolve(__dirname, '../../..'));
    expect(code).toBe(0);
  });

  it('refuses an optional, which is the shape that shipped', () => {
    const { code, output } = generated(
      'const C = new FfiConverterOptional(FfiConverterTypeEngineObserver);'
    );
    expect(code).toBe(1);
    expect(output).toContain('FfiConverterTypeEngineObserver');
    expect(output).toContain('FfiConverterOptional');
  });

  it('refuses an optional the generator wrapped across lines', () => {
    const { code } = generated(
      'const C = new FfiConverterOptional(\n  FfiConverterTypeEngineObserver,\n);'
    );
    expect(code).toBe(1);
  });

  it('refuses a sequence and a map, which take the same path', () => {
    expect(generated('const C = new FfiConverterArray(FfiConverterTypeEngineObserver);').code).toBe(
      1
    );
    expect(
      generated(
        'const C = new FfiConverterMap(FfiConverterString, FfiConverterTypeEngineObserver);'
      ).code
    ).toBe(1);
  });

  it('refuses a record field, which writes into the cursor directly', () => {
    const { code, output } = generated(
      'FfiConverterTypeEngineObserver.write(value.observer, into);'
    );
    expect(code).toBe(1);
    expect(output).toContain('write');
  });

  it('allows the handle-map calls and the export list', () => {
    const { code } = generated(
      [
        'FfiConverterTypeEngineObserver.lower(observer, alloc);',
        'FfiConverterTypeEngineObserver.lift(uniffiHandle);',
        'FfiConverterTypeEngineObserver.drop(uniffiHandle);',
        'FfiConverterTypeEngineObserver.clone(uniffiHandle);',
        'export const converters = {\n  FfiConverterTypeEngineObserver,\n};',
      ].join('\n')
    );
    expect(code).toBe(0);
  });
});
