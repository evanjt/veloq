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
  'src/__tests__/bugs/asyncWaitBudget.test.ts',
  'src/__tests__/bugs/auditIdLintExitCode.test.ts',
  'src/__tests__/bugs/commentGuardsReadEveryCommentForm.test.ts',
  'src/__tests__/bugs/auSpellingLintExitCode.test.ts',
  'src/__tests__/bugs/bashEmptyArrayGuard.test.ts',
  'src/__tests__/bugs/cargoConfigReachGuard.test.ts',
  'src/__tests__/bugs/commentLineRefLintExitCode.test.ts',
  'src/__tests__/bugs/commitGateExitCode.test.ts',
  'src/__tests__/bugs/commitIndexGuard.test.ts',
  'src/__tests__/bugs/conflictedMergeRunsMergeGates.test.ts',
  'src/__tests__/bugs/coverageIncludesScreens.test.ts',
  'src/__tests__/bugs/detectorOrderingLintExitCode.test.ts',
  'src/__tests__/bugs/e2eGateWorkflow.test.ts',
  'src/__tests__/bugs/e2eIosSweepFinishes.test.ts',
  'src/__tests__/bugs/e2eDailySweep.test.ts',
  'src/__tests__/bugs/e2eSweepRestartsTheDevice.test.ts',
  'src/__tests__/bugs/e2eReportsProducerCommit.test.ts',
  'src/__tests__/bugs/emDashLintExitCode.test.ts',
  'src/__tests__/bugs/engineClientReach.test.ts',
  'src/__tests__/bugs/expoLocationAltitudeGuard.test.ts',
  'src/__tests__/bugs/fastForwardMergeGate.test.ts',
  'src/__tests__/bugs/featureImportLintExitCode.test.ts',
  'src/__tests__/bugs/feedIndicatorSweep.test.ts',
  'src/__tests__/bugs/ffiUsageReport.test.ts',
  'src/__tests__/bugs/fixGeneratedIdempotent.test.ts',
  'src/__tests__/bugs/foreignConverterCursor.test.ts',
  'src/__tests__/bugs/formatStagedLeavesTheStash.test.ts',
  'src/__tests__/bugs/generatedFilesTracked.test.ts',
  'src/__tests__/bugs/guardsReadTheIndex.test.ts',
  'src/__tests__/bugs/guardsRefuseAnEmptyCorpus.test.ts',
  'src/__tests__/bugs/indexReaderOddPaths.test.ts',
  'src/__tests__/bugs/jestCacheOffTmpfs.test.ts',
  'src/__tests__/bugs/jestWorkerCap.test.ts',
  'src/__tests__/bugs/landBranchOffTheRefRace.test.ts',
  'src/__tests__/bugs/retiredHistoryRefusedAtMerge.test.ts',
  'src/__tests__/bugs/landedRangeGates.test.ts',
  'src/__tests__/bugs/lintGuardGitEnv.test.ts',
  'src/__tests__/bugs/podSourceLinkGuard.test.ts',
  'src/__tests__/bugs/lintZeroWarnings.test.ts',
  'src/__tests__/bugs/maestroFlowTags.test.ts',
  'src/__tests__/bugs/maestroWrapperDevice.test.ts',
  'src/__tests__/bugs/mergeFormatScope.test.ts',
  'src/__tests__/bugs/mergeLintCeiling.test.ts',
  'src/__tests__/bugs/mergeLintScope.test.ts',
  'src/__tests__/bugs/mergeMessageGuard.test.ts',
  'src/__tests__/bugs/mergeRustFmt.test.ts',
  'src/__tests__/bugs/mergeTestTargets.test.ts',
  'src/__tests__/bugs/mergeTypecheck.test.ts',
  'src/__tests__/bugs/moduleLinkGuard.test.ts',
  'src/__tests__/bugs/oneIndexReader.test.ts',
  'src/__tests__/bugs/oneObserverVtable.test.ts',
  'src/__tests__/bugs/pressFeedbackLint.test.ts',
  'src/__tests__/bugs/reachabilityAuditExitCode.test.ts',
  'src/__tests__/bugs/recordingFlowsCleanUpFirst.test.ts',
  'src/__tests__/bugs/recordingFlowsSurviveAutoPause.test.ts',
  'src/__tests__/bugs/renderEngineReadLintExitCode.test.ts',
  'src/__tests__/bugs/rustCoverageGateExitCode.test.ts',
  'src/__tests__/bugs/rustFmtGate.test.ts',
  'src/__tests__/bugs/rustTestTreeBuilds.test.ts',
  'src/__tests__/bugs/skipOneGate.test.ts',
  'src/__tests__/bugs/sportTaxonomyGenerated.test.ts',
  'src/__tests__/bugs/stagedTreeGuard.test.ts',
  'src/__tests__/bugs/submodulePointerGuard.test.ts',
  'src/__tests__/bugs/suiteDeviceDeath.test.ts',
  'src/__tests__/bugs/tracematchLockfileGuard.test.ts',
  'src/__tests__/bugs/unifiedConfigGenerated.test.ts',
  'src/__tests__/bugs/windowDimensionsLintExitCode.test.ts',
  'src/__tests__/lib/buildStamp.test.ts',
  'src/__tests__/lib/expoLocationAltitude.test.ts',
  'src/__tests__/lib/maestroDeepLinks.test.ts',
  'src/__tests__/lib/storeMetadataChangelog.test.ts',
  'src/__tests__/bugs/testFixturesOutsideTheTree.test.ts',
  'src/__tests__/bugs/testsNeverGitAgainstTheRepo.test.ts',
  'src/__tests__/bugs/veloqrsStubIsTheOnlyMock.test.ts',
];

module.exports = { toolingDirectories, toolingSuites };
