/**
 * Scenario: `EngineClient.engine` and the generated module were typed `any`, so
 * a call to a method the bindings no longer export compiled and failed on the
 * device.
 *
 * Expected behaviour: the engine handle is the generated `VeloqEngineLike`, so
 * `tsc` rejects a call the bindings do not export. The assertions are checked
 * by `tsc`; Jest only confirms the file loads.
 */

import type {
  FfiRecordRestoreResult,
  FfiUnplacedRecord,
  VeloqEngineLike,
} from '../../../modules/veloqrs/src/generated/veloqrs';
import type { EngineClient } from '../../../modules/veloqrs/src/EngineClient';

type IsAny<T> = 0 extends 1 & T ? true : false;
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const engineIsNotAny: IsAny<EngineClient['engine']> extends false ? true : never = true;
const engineIsTheGeneratedHandle: Equals<EngineClient['engine'], VeloqEngineLike> = true;

const restoreZipReturnsTheGeneratedResult: Equals<
  ReturnType<EngineClient['restoreRecordZip']>,
  Promise<FfiRecordRestoreResult>
> = true;
const restoreJsonReturnsTheGeneratedResult: Equals<
  ReturnType<EngineClient['restoreRecordJson']>,
  Promise<FfiRecordRestoreResult>
> = true;
const unplacedRecordsAreTheGeneratedRecords: Equals<
  ReturnType<EngineClient['getUnplacedBackupRecords']>,
  Promise<FfiUnplacedRecord[]>
> = true;

function callsAMissingMethod(client: EngineClient) {
  // @ts-expect-error the generated handle exports no such method
  client.engine.runNoSuchExport();
}

it('types the engine handle against the generated bindings', () => {
  expect([
    engineIsNotAny,
    engineIsTheGeneratedHandle,
    restoreZipReturnsTheGeneratedResult,
    restoreJsonReturnsTheGeneratedResult,
    unplacedRecordsAreTheGeneratedRecords,
    callsAMissingMethod,
  ]).toBeDefined();
});
