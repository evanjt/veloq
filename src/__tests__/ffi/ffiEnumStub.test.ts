/**
 * Scenario: a closed set that crosses the FFI as an enum is declared once in
 * Rust and generated into TypeScript, but the Jest stub for the binding
 * cannot import the generated module and so carries its own copy.
 *
 * Expected behaviour: the stub's copy is held to the generated declaration,
 * member for member and value for value, in the contract table, so a variant
 * added in Rust fails there rather than in a test that quietly passes against
 * a stale stub. Here, no member is falsy.
 */

import {
  BulkExportFormat,
  CallKind,
  InitOutcome,
  StartOutcome,
  SyncErrorReason,
  SyncState,
  SyncStep,
  UploadOutcome,
} from '../__shared__/veloqrsStub';

/** The members of a TypeScript numeric enum, without the reverse mapping. */
function membersOf(value: Record<string, unknown>): Record<string, number> {
  const members: Record<string, number> = {};
  for (const [key, member] of Object.entries(value)) {
    if (typeof member === 'number') members[key] = member;
  }
  return members;
}

describe('the binding stub enums', () => {
  it('start every member at one so none is falsy', () => {
    for (const value of Object.values(membersOf(CallKind))) expect(value).toBeGreaterThan(0);
    for (const value of Object.values(membersOf(SyncState))) expect(value).toBeGreaterThan(0);
    for (const value of Object.values(membersOf(SyncErrorReason))) expect(value).toBeGreaterThan(0);
    for (const value of Object.values(membersOf(SyncStep))) expect(value).toBeGreaterThan(0);
    for (const value of Object.values(membersOf(BulkExportFormat)))
      expect(value).toBeGreaterThan(0);
    for (const value of Object.values(membersOf(StartOutcome))) expect(value).toBeGreaterThan(0);
    for (const value of Object.values(membersOf(InitOutcome))) expect(value).toBeGreaterThan(0);
    for (const value of Object.values(membersOf(UploadOutcome))) expect(value).toBeGreaterThan(0);
  });
});
