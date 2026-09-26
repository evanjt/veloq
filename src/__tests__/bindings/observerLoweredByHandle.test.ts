/**
 * Scenario: `setObserver` took an optional observer, and the binding lowers
 * an optional through its byte cursor. That path never consults the handle
 * map a JavaScript implementation lives in, so registration threw "Cannot
 * lower this object to a pointer" on every launch, the observer was withheld,
 * and every screen ran deaf from the generator upgrade of 2026-09-15.
 *
 * Expected behaviour: the runtime's optional path refuses a JavaScript
 * implementation, which is the hazard, and the generated `setObserver` takes
 * a bare observer so the object goes through `lower` and the handle map.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FfiConverterObjectWithCallbacks, FfiConverterOptional } from 'uniffi-bindgen-react-native';

const GENERATED = join(__dirname, '../../../modules/veloqrs/src/generated/veloqrs.ts');

/** A factory for a type that has no Rust-backed instance in this process. */
const foreignOnlyFactory = {
  isConcreteType: () => false,
  create: () => {
    throw new Error('not lifted here');
  },
  bless: () => {
    throw new Error('not blessed here');
  },
  unbless: () => {},
  pointer: () => {
    throw new Error('no pointer');
  },
  clonePointer: () => {
    throw new Error('no pointer');
  },
  freePointer: () => {},
};

const alloc = (n: number) => new Uint8Array(n);

describe('lowering a JavaScript observer', () => {
  it('goes through the handle map when lowered bare', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const converter = new FfiConverterObjectWithCallbacks<object>(foreignOnlyFactory as any);
    const handle = converter.lower({ syncProgress() {} }, alloc);
    expect(typeof handle).toBe('bigint');
    expect(handle % BigInt(2)).toBe(BigInt(1));
  });

  it('is refused by the optional cursor path, which is the hazard', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const converter = new FfiConverterObjectWithCallbacks<object>(foreignOnlyFactory as any);
    const optional = new FfiConverterOptional(converter);
    expect(() => optional.lower({ syncProgress() {} }, alloc)).toThrow(
      'Cannot lower this object to a pointer'
    );
  });

  it('is never wrapped in an optional by the generated setObserver', () => {
    const source = readFileSync(GENERATED, 'utf8');
    expect(source).toMatch(/setObserver\(observer: EngineObserver\): void/);
    expect(source).not.toContain('FfiConverterOptionalTypeEngineObserver');
  });
});
