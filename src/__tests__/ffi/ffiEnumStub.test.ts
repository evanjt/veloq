/**
 * Scenario: a closed set that crosses the FFI as an enum is declared once in
 * Rust and generated into TypeScript, but the Jest stub for the binding
 * cannot import the generated module and so carries its own copy.
 *
 * Expected behaviour: the stub's copy is held to the generated declaration,
 * member for member and value for value, so a variant added in Rust fails
 * here rather than in a test that quietly passes against a stale stub.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CallKind, SyncState } from '../__shared__/veloqrsStub';

const GENERATED = resolve('modules/veloqrs/src/generated/veloqrs.ts');

/** `export enum Name { A = 1, B = 2 }` from the generated source, as name to value. */
function generatedEnum(name: string): Record<string, number> {
  const source = readFileSync(GENERATED, 'utf-8');
  const block = source.match(new RegExp(`export enum ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!block) throw new Error(`the generated binding declares no enum ${name}`);
  const members: Record<string, number> = {};
  for (const line of block[1].split('\n')) {
    const member = line.trim().match(/^([A-Za-z]+)(?:\s*=\s*(\d+))?,?$/);
    if (member) members[member[1]] = member[2] === undefined ? NaN : Number(member[2]);
  }
  return members;
}

/** The members of a TypeScript numeric enum, without the reverse mapping. */
function membersOf(value: Record<string, unknown>): Record<string, number> {
  const members: Record<string, number> = {};
  for (const [key, member] of Object.entries(value)) {
    if (typeof member === 'number') members[key] = member;
  }
  return members;
}

describe('the binding stub enums', () => {
  it('carry FfiCallKind as the generated binding declares it', () => {
    expect(membersOf(CallKind)).toEqual(generatedEnum('FfiCallKind'));
  });

  it('carry SyncState as the generated binding declares it', () => {
    expect(membersOf(SyncState)).toEqual(generatedEnum('SyncState'));
  });

  it('start every member at one so none is falsy', () => {
    for (const value of Object.values(membersOf(CallKind))) expect(value).toBeGreaterThan(0);
    for (const value of Object.values(membersOf(SyncState))) expect(value).toBeGreaterThan(0);
  });
});
