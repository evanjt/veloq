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
  FfiCallKind,
  FfiInitOutcome,
  RecordScope,
  FfiStartOutcome,
  FfiSyncErrorReason,
  SyncState,
  FfiSyncStep,
  FfiTrackStep,
  FfiUploadOutcome,
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
    for (const value of Object.values(membersOf(FfiCallKind))) expect(value).toBeGreaterThan(0);
    for (const value of Object.values(membersOf(SyncState))) expect(value).toBeGreaterThan(0);
    for (const value of Object.values(membersOf(FfiSyncErrorReason)))
      expect(value).toBeGreaterThan(0);
    for (const value of Object.values(membersOf(FfiSyncStep))) expect(value).toBeGreaterThan(0);
    for (const value of Object.values(membersOf(FfiTrackStep))) expect(value).toBeGreaterThan(0);
    for (const value of Object.values(membersOf(BulkExportFormat)))
      expect(value).toBeGreaterThan(0);
    for (const value of Object.values(membersOf(RecordScope))) expect(value).toBeGreaterThan(0);
    for (const value of Object.values(membersOf(FfiStartOutcome))) expect(value).toBeGreaterThan(0);
    for (const value of Object.values(membersOf(FfiInitOutcome))) expect(value).toBeGreaterThan(0);
    for (const value of Object.values(membersOf(FfiUploadOutcome)))
      expect(value).toBeGreaterThan(0);
  });
});
