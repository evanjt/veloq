// The suites whose subject is the repository's tooling rather than the app:
// the guard scripts, the hooks, the workflows, the Maestro flow files, the Jest
// config and the test tree itself. `npm test` leaves them out and
// `npm run test:tooling` runs them, because the whole-tree lint and git
// fixture runs among them were a third of the suite's CPU and none of them can
// fail because the app changed.
//
// The rule is that a suite naming a path under scripts/, config/, .husky/,
// .github/ or .maestro/ in its code belongs here, and
// src/__tests__/scripts/jestProjects.test.ts refuses one left in `app`. The
// three at the end name no such path and guard the test tree instead. A file
// listed here that no longer exists fails the same suite, so a rename cannot
// quietly move a guard back into `app`.

/** Every suite under these directories is tooling. */
const toolingDirectories = ['src/__tests__/scripts/'];

/** Tooling suites that sit beside app suites, by repository path. */
const toolingSuites = [
  'src/__tests__/bindings/ffiBindingValidation.test.ts',
  'src/__tests__/bugs/androidBundleStaleness.test.ts',
  'src/__tests__/bugs/commitGateExitCode.test.ts',
  'src/__tests__/bugs/commitIndexGuard.test.ts',
  'src/__tests__/bugs/conflictedMergeRunsMergeGates.test.ts',
  'src/__tests__/bugs/detectorOrderingLintExitCode.test.ts',
  'src/__tests__/bugs/e2eGateShards.test.ts',
  'src/__tests__/bugs/expoLocationAltitudeGuard.test.ts',
  'src/__tests__/bugs/fixGeneratedIdempotent.test.ts',
  'src/__tests__/bugs/foreignConverterCursor.test.ts',
  'src/__tests__/bugs/landBranchOffTheRefRace.test.ts',
  'src/__tests__/bugs/retiredHistoryRefusedAtMerge.test.ts',
  'src/__tests__/bugs/landedRangeGates.test.ts',
  'src/__tests__/bugs/podSourceLinkGuard.test.ts',
  'src/__tests__/bugs/maestroWrapperDevice.test.ts',
  'src/__tests__/bugs/mergeTestTargets.test.ts',
  'src/__tests__/bugs/moduleLinkGuard.test.ts',
  'src/__tests__/bugs/sportTaxonomyGenerated.test.ts',
  'src/__tests__/bugs/stagedTreeGuard.test.ts',
  'src/__tests__/bugs/submodulePointerGuard.test.ts',
  'src/__tests__/bugs/suiteDeviceDeath.test.ts',
  'src/__tests__/bugs/suiteRealAccountAndBinary.test.ts',
  'src/__tests__/bugs/tracematchLockfileGuard.test.ts',
  'src/__tests__/bugs/unifiedConfigGenerated.test.ts',
  'src/__tests__/lib/storeMetadataChangelog.test.ts',
  'src/__tests__/lib/storePrivacyDeclarations.test.ts',
  'src/__tests__/plugins/withStoreKitConfiguration.test.ts',
];

module.exports = { toolingDirectories, toolingSuites };
