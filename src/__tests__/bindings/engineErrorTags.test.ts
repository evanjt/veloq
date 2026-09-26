/**
 * Scenario: `VeloqError` is a typed enum the bindings carry across, and the
 * shared reader spells the variants rather than importing them, so a consumer
 * naming a failure does not pull the native binding chain in for a string.
 *
 * Expected behaviour: a variant added, renamed or removed in Rust fails here
 * rather than falling silently into the fallback message at every call site.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ENGINE_ERROR_TAGS,
  engineErrorTag,
  engineErrorDetail,
  engineErrorKey,
} from '@/shared/native/engineError';

const GENERATED = resolve('modules/veloqrs/src/generated/veloqrs.ts');

/** The generated `export enum VeloqError_Tags { ... }` block, as its members. */
function generatedTags(): string[] {
  const source = readFileSync(GENERATED, 'utf-8');
  const block = /export enum VeloqError_Tags \{([^}]*)\}/.exec(source);
  if (!block) throw new Error('VeloqError_Tags is not in the generated bindings');
  return [...block[1].matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((m) => m[1]);
}

describe('the engine error tags', () => {
  it('are exactly the variants the bindings carry', () => {
    expect([...ENGINE_ERROR_TAGS].sort()).toEqual(generatedTags().sort());
  });
});

describe('reading a failure the engine reported', () => {
  it('names the variant off the tag the binding put there', () => {
    expect(engineErrorTag({ tag: 'LockFailed' })).toBe('LockFailed');
    expect(engineErrorTag({ tag: 'Database', inner: { msg: 'disk I/O error' } })).toBe('Database');
  });

  it('answers nothing for a failure that is not the engine', () => {
    expect(engineErrorTag(new Error('Catalogue clear did not finish in time'))).toBeUndefined();
    expect(engineErrorTag('LockFailed')).toBeUndefined();
    expect(engineErrorTag(null)).toBeUndefined();
    expect(engineErrorTag({ tag: 'SomethingElse' })).toBeUndefined();
  });

  it('hands back what Rust said, where the variant carries it', () => {
    expect(engineErrorDetail({ tag: 'Database', inner: { msg: 'disk I/O error' } })).toBe(
      'disk I/O error'
    );
    expect(engineErrorDetail({ tag: 'LockFailed' })).toBeUndefined();
    expect(engineErrorDetail(new Error('nope'))).toBeUndefined();
  });

  it('tells the engine not being open from the database failing', () => {
    expect(engineErrorKey({ tag: 'NotInitialized' }, 'alerts.failedToClear')).toBe(
      'engine.failure.notOpen'
    );
    expect(engineErrorKey({ tag: 'Database', inner: { msg: 'x' } }, 'alerts.failedToClear')).toBe(
      'engine.failure.database'
    );
    expect(engineErrorKey({ tag: 'LockFailed' }, 'alerts.failedToClear')).toBe(
      'engine.failure.busy'
    );
  });

  it('leaves a failure of our own on the fallback the caller gave', () => {
    expect(engineErrorKey(new Error('did not finish in time'), 'alerts.failedToClear')).toBe(
      'alerts.failedToClear'
    );
  });
});
