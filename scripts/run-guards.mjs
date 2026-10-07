#!/usr/bin/env node
// Runs the repository's guard scripts at once and reports every failure.
//
// They ran one after another behind 39 `npm run` calls, which was 22 s of every
// commit, and all of it was process start-up rather than checking. Each guard
// here names the regression it would catch: a guard that cannot say what it
// catches does not belong in a gate, and the test beside this file refuses an
// entry without one.
//
// Sets:
//   commit       correctness guards, run by pre-commit
//   land         correctness, style, environment and build, run by the merge gates
//   all          the same as land, run by CI through `npm run audit`
//   environment  the worktree checks alone, `npm run doctor`
//
// Usage: node scripts/run-guards.mjs [--set commit|land|all|environment] [--list | --json]
// `--guards <file.json>` swaps the list for a test's own, the way `--root` does in
// the lints.

import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';

import { gitFreeEnv } from './lib/indexedSources.mjs';

const node = (script, ...args) => ['node', `scripts/${script}`, ...args];
const tsx = (script, ...args) => ['npx', 'tsx', `scripts/${script}`, ...args];

// correctness: a violation is a broken build, a wrong number or a crash.
// style: the code works either way, and the guard keeps it consistent.
// environment: the worktree this runs in is set up wrongly, not the code.
// build: correctness checks that need the host compiler, run at land and in CI.
const GUARDS = [
  {
    name: 'check:bindings-fresh',
    kind: 'build',
    cmd: node('check-bindings-fresh.mjs'),
    catches:
      'stale generated bindings after a Rust signature or doc comment changes its UniFFI checksum',
  },
  {
    name: 'check:module-version',
    kind: 'correctness',
    cmd: node('check-module-version.mjs'),
    catches: 'an app release carrying a veloqrs pod with a stale version and source tag',
  },
  {
    name: 'check:licences',
    kind: 'correctness',
    cmd: node('check-license-coverage.mjs'),
    catches:
      'a direct shipped dependency missing its in-app licence or repository and notice entry',
  },
  {
    name: 'check:production-console',
    kind: 'correctness',
    cmd: node('check-production-console.mjs'),
    catches:
      'a release bundle shipping debug logs or dropping console errors after a Babel config change',
  },
  {
    name: 'check:worklets',
    kind: 'correctness',
    cmd: node('patch-worklets-lifecycle.js', '--check'),
    catches:
      'a missing worklets lifecycle repair that leaves vsync running while Android caches the app',
  },
  {
    name: 'check:expo',
    kind: 'correctness',
    cmd: node('check-expo-sdk.mjs'),
    catches: 'an Expo package on a different SDK major than expo, which breaks the native build',
  },
  {
    name: 'check:android-prebuild',
    kind: 'correctness',
    cmd: node('check-android-prebuild.mjs'),
    catches:
      'the tracked Android build files losing the dev id, version, release signing or Google services a prebuild overwrites',
  },
  {
    name: 'check:debug-push-receiver',
    kind: 'correctness',
    cmd: node('check-debug-push-receiver.mjs'),
    catches: 'an exported debug push receiver entering a release manifest',
  },
  {
    name: 'check:private-data',
    kind: 'correctness',
    cmd: ['bash', 'scripts/check-no-private-data.sh', '--all'],
    catches:
      'a GPS track, a database or a private/ file tracked from a hookless commit, which stays public once pushed',
  },
  {
    name: 'config:sports:check',
    kind: 'correctness',
    cmd: tsx('generate-sport-taxonomy.ts', '--check'),
    catches: 'the generated sport taxonomy drifting from its Rust source',
  },
  {
    name: 'config:trend:check',
    kind: 'correctness',
    cmd: tsx('generate-trend-table.ts', '--check'),
    catches: 'the generated trend table drifting from its Rust source',
  },
  {
    name: 'ffi:reach',
    kind: 'correctness',
    cmd: tsx('ffi-usage-report.ts', '--check'),
    catches: 'an engine export no TypeScript caller reaches and no list accounts for',
  },
  {
    name: 'ffi:orphans:check',
    kind: 'correctness',
    cmd: node('engine-orphan-report.mjs', '--check'),
    catches:
      'an engine method only tests call, or none call, that the checked-in list does not account for',
  },
  {
    name: 'ffi:area-check',
    kind: 'correctness',
    cmd: tsx('ffi-usage-report.ts', '--check-areas'),
    catches: 'a feature area reaching engine exports beyond its ceiling, or a stale ceiling entry',
  },
  {
    name: 'crash:guard',
    kind: 'correctness',
    cmd: node('crash-guard-sweep.mjs'),
    catches:
      'latent crashes: Math.max or Math.min over a possibly empty spread, an unguarded JSON.parse',
  },
  {
    name: 'check:rust-ffi-panic-boundaries',
    kind: 'correctness',
    cmd: node('check-rust-ffi-panic-boundaries.mjs'),
    catches:
      'a C or JNI entry point losing its panic refusal during a merge and aborting the app process',
  },
  {
    name: 'check:rust-file-locks',
    kind: 'correctness',
    cmd: node('check-rust-file-locks.mjs'),
    catches:
      'a std File lock in the engine, which Android refuses at runtime and which closed the engine on every Android launch',
  },
  {
    name: 'lint:engine-bridge',
    kind: 'correctness',
    cmd: node('engine-event-bridge-audit.mjs'),
    catches:
      'engine-derived data that nothing invalidates after a sync, the strength and wellness stale-data bugs',
  },
  {
    name: 'lint:render-engine-reads',
    kind: 'correctness',
    cmd: node('lint-render-engine-reads.mjs'),
    catches: 'a synchronous engine read in render, which blocks the JS thread every frame',
  },
  {
    name: 'lint:untyped-require',
    kind: 'correctness',
    cmd: node('lint-untyped-require.mjs'),
    catches:
      'a lazily required name missing from its module, which typechecks as any and throws at runtime',
  },
  {
    name: 'lint:muscle-polygons',
    kind: 'correctness',
    cmd: node('generate-muscle-polygons.mjs', '--check'),
    catches: 'the generated muscle polygons drifting from their source drawing',
  },
  {
    name: 'lint:expo-location-altitude',
    kind: 'correctness',
    cmd: node('lint-expo-location-altitude.mjs'),
    catches: 'an unpatched expo-location, so an Android fix with no altitude records 0 m',
  },
  {
    name: 'lint:detector-ordering',
    kind: 'correctness',
    cmd: node('lint-detector-ordering.mjs'),
    catches:
      'a public function returning a hash container, whose seed makes detection order differ run to run',
  },
  {
    name: 'lint:pod-source-links',
    kind: 'correctness',
    cmd: node('lint-pod-source-links.mjs'),
    catches:
      'a tracked link in the iOS pod directory that CocoaPods does not follow, bundling no files',
  },
  {
    name: 'lint:generated-files',
    kind: 'correctness',
    cmd: node('lint-generated-files.mjs'),
    catches: 'a generated file a fresh clone cannot regenerate going untracked',
  },
  {
    name: 'config:activity-window:check',
    kind: 'correctness',
    cmd: node('generate-activity-window.mjs', '--check'),
    catches:
      'a Rust activity window change leaving the settings range and empty library answer stale',
  },
  {
    name: 'lint:engine-surface',
    kind: 'correctness',
    // Through npm, so the ceilings stay in the one place the ratchet tells you to
    // lower them.
    cmd: ['npm', 'run', '--silent', 'lint:engine-surface'],
    catches: 'a new direct engine call site or store, giving a fact a second reader',
  },
  {
    name: 'lint:submodule-pointer',
    kind: 'correctness',
    cmd: node('lint-submodule-pointer.mjs'),
    catches:
      'the tracematch pointer and the submodule on disk disagreeing, so builds test the wrong detector',
  },
  {
    name: 'lint:detector-revision',
    kind: 'correctness',
    cmd: node('lint-detector-revision.mjs'),
    catches:
      "a tracematch pointer bump that moves the bitwise golden with DETECTOR_REVISION unchanged, so upgraded installs adopt the old detector's evidence cache",
  },
  {
    name: 'lint:tracematch-lockfile',
    kind: 'correctness',
    cmd: node('lint-tracematch-lockfile.mjs'),
    catches:
      "tracematch's standalone Cargo.lock naming another version than its manifest, which fails its CI publish after the next push",
  },
  {
    name: 'lint:device-writes',
    kind: 'correctness',
    cmd: node('lint-device-writes.mjs'),
    catches:
      'a new place the app or the engine writes on the device that the wipe inventory does not list, so an athlete hand-off leaves it behind',
  },
  {
    name: 'lint:engine-write-lock',
    kind: 'correctness',
    cmd: node('lint-engine-write-lock.mjs'),
    catches: 'a screen read moved onto the pooled reader going back to the write lock',
  },
  {
    name: 'lint:sync-writes-stamped',
    kind: 'correctness',
    cmd: node('lint-sync-writes-stamped.mjs'),
    catches:
      'a sync write that takes the engine without its install, so a restore mid-pass writes the old library into the restored database',
  },
  {
    name: 'lint:detect-recv',
    kind: 'correctness',
    cmd: node('lint-detect-recv.mjs'),
    catches:
      'a detection recv that defaults away a refused or dead run, reading it as an empty catalogue',
  },
  {
    name: 'lint:bare-thread-spawn',
    kind: 'correctness',
    cmd: node('lint-bare-thread-spawn.mjs'),
    catches:
      'a long engine pass spawned unnamed, so a per-thread sampler reads it as the JavaScript thread',
  },
  {
    name: 'lint:point-shapes',
    kind: 'correctness',
    cmd: node('lint-point-shapes.mjs'),
    catches:
      'a local copy of the track point type that stops following LatLng when a field is added or renamed',
  },
  {
    name: 'lint:setting-keys',
    kind: 'correctness',
    cmd: node('lint-setting-keys.mjs'),
    catches:
      'a key written through setSetting that the settings migration does not copy, so an upgrade silently drops that preference',
  },
  {
    name: 'lint:maestro-ids',
    kind: 'correctness',
    cmd: node('lint-maestro-ids.mjs'),
    catches: 'a Maestro flow naming a testID no component renders',
  },
  {
    name: 'lint:device-drivers',
    kind: 'correctness',
    cmd: node('lint-device-drivers.mjs'),
    catches:
      'a script driving the handset outside the device lock, or running Maestro bare so a flow lands on the other phone',
  },
  {
    name: 'lint:observer-vtable',
    kind: 'correctness',
    cmd: node('lint-one-observer-vtable.mjs'),
    catches:
      'a second binding installing the engine observer vtable, where the last writer silently wins',
  },
  {
    name: 'lint:foreign-converter',
    kind: 'correctness',
    cmd: node('lint-foreign-converter-cursor.mjs'),
    catches: 'a JavaScript-implemented object written through a cursor, which throws at the FFI',
  },
  {
    name: 'lint:ffi-throw-type',
    kind: 'correctness',
    cmd: node('lint-ffi-throw-type.mjs'),
    catches: 'an export throwing anything but VeloqError, which panics the bindings generator',
  },
  {
    name: 'lint:engine-read-empty',
    kind: 'correctness',
    cmd: node('lint-engine-read-empty.mjs'),
    catches:
      'an engine client read answering a thrown VeloqError with an empty value a caller reads as nothing there',
  },
  {
    name: 'lint:generated-free-functions',
    kind: 'correctness',
    cmd: node('lint-generated-free-functions.mjs'),
    catches:
      'a screen importing a synchronous generated function from veloqrs and calling it past the timing wrapper, so the FFI table never lists it',
  },
  {
    name: 'lint:ffi-bigint',
    kind: 'correctness',
    cmd: node('lint-ffi-bigint.mjs'),
    catches:
      'a record field, export parameter or export return TypeScript lifts as bigint, which JSON.stringify throws on in release',
  },
  {
    name: 'lint:decline-visible',
    kind: 'correctness',
    cmd: node('lint-decline-visible.mjs'),
    catches: 'a job that declines below warn level, which a release engine on a phone never logs',
  },
  {
    name: 'lint:trend-thresholds',
    kind: 'correctness',
    cmd: node('lint-trend-thresholds.mjs'),
    catches:
      'a surface handing a trend call its own threshold or its own copy of the call, so two cards call the same week up and flat',
  },
  {
    name: 'lint:zero-warnings',
    kind: 'correctness',
    cmd: node('lint-zero-warnings.mjs'),
    catches:
      'a commit raising --max-warnings beside the warnings that fill it, or an ESLint cache in the node_modules every worktree shares',
  },
  {
    name: 'lint:jest-mocks',
    kind: 'correctness',
    cmd: node('lint-jest-mock-partial.mjs'),
    catches:
      'a jest.mock factory that replaces a whole package, leaving every export it omits undefined for the rest of the suite',
  },
  {
    name: 'lint:test-timezone',
    kind: 'correctness',
    cmd: node('lint-test-timezone.mjs'),
    catches:
      'a Jest suite assigning process.env.TZ, which changes nothing after the worker has read its zone, so its timezone cases only ever run in the machine zone',
  },
  {
    name: 'lint:rust-manifests',
    kind: 'correctness',
    cmd: node('lint-rust-manifests.mjs'),
    catches:
      'a feature-gated Rust test or bench with no required-features stanza reporting `ok. 0 passed`, a member profile cargo discards, or the root and tracematch release profiles drifting apart',
  },
  {
    name: 'lint:rust-test-wall-clock',
    kind: 'correctness',
    cmd: node('lint-rust-test-wall-clock.mjs'),
    catches:
      'a Rust test asserting a wall-clock bound, which fails the per-push lane when the machine is busy rather than when the code regresses',
  },
  {
    name: 'lint:rust-test-serial',
    kind: 'correctness',
    cmd: node('lint-rust-test-serial.mjs'),
    catches:
      'a Rust test reading the global engine install without the serial lock, which is refused only in filtered or loaded runs when a parallel test moves the install',
  },
  {
    name: 'lint:test-temp-dirs',
    kind: 'correctness',
    cmd: node('lint-test-temp-dirs.mjs'),
    catches:
      'the Jest temp directory cleanup being dropped, or a test making a temp path outside it, which leaks a directory per run until /tmp has no inodes and every gate fails',
  },
  {
    name: 'lint:workflows',
    kind: 'correctness',
    cmd: node('lint-workflows.mjs'),
    catches:
      'a cache written off main, a schedule re-running an unchanged sha or skipping one measured red as green, a superseded main push read as red, a job no aggregator reports, benches linked or left unchecked, a native build copied outside its platform definition, a call passing inputs the definition does not declare, or a cache key hashing what the build wrote',
  },
  {
    name: 'lint:static-loading-glyph',
    kind: 'correctness',
    cmd: node('lint-source-rules.mjs', '--rule', 'static-loading-glyph'),
    catches: 'a wait drawn as the static loading glyph, which never turns',
  },
  {
    name: 'lint:coverage-hooks-read',
    kind: 'correctness',
    cmd: node('lint-source-rules.mjs', '--rule', 'coverage-hooks-read'),
    catches: 'a coverage hook reading around a subscription trigger, which goes stale after a sync',
  },
  {
    name: 'lint:picker-default-period',
    kind: 'correctness',
    cmd: node('lint-source-rules.mjs', '--rule', 'picker-default-period'),
    catches: 'a period picker opening on a literal of its own rather than the shared default',
  },
  {
    name: 'lint:insight-targets',
    kind: 'correctness',
    cmd: node('lint-source-rules.mjs', '--rule', 'insight-targets'),
    catches: 'an insight card sending the athlete to the Insights tab the sheet was opened from',
  },
  {
    name: 'lint:glyph-stacks',
    kind: 'correctness',
    cmd: node('lint-source-rules.mjs', '--rule', 'glyph-stacks'),
    catches:
      'a 3D map label with no bundled text-font, which fetches its glyphs off the network and 404s',
  },
  {
    name: 'lint:metrics-one-writer',
    kind: 'correctness',
    cmd: node('lint-source-rules.mjs', '--rule', 'metrics-one-writer'),
    catches:
      'a TypeScript activity_metrics write beside the engine writer, which replaces its row with a second precedence',
  },
  {
    name: 'lint:one-library-open',
    kind: 'correctness',
    cmd: node('lint-source-rules.mjs', '--rule', 'one-library-open'),
    catches: 'an engine open that leaves the library in the iOS device backup',
  },
  {
    name: 'lint:shared-import-cycles',
    kind: 'correctness',
    cmd: node('lint-source-rules.mjs', '--rule', 'shared-import-cycles'),
    catches:
      'a cycle between modules under src/shared, whose initialisation order breaks on the one import that trips it',
  },
  {
    name: 'lint:shared-ui-accessibility',
    kind: 'correctness',
    cmd: node('lint-source-rules.mjs', '--rule', 'shared-ui-accessibility'),
    catches:
      'a shared pressable with no accessibility role or label, inherited by every screen that adopts it',
  },
  {
    name: 'lint:banner-live-region',
    kind: 'correctness',
    cmd: node('lint-source-rules.mjs', '--rule', 'banner-live-region'),
    catches:
      'an offline, save-error or sync banner that appears with no live region or announcement, so a screen reader says nothing',
  },
  {
    name: 'lint:selected-state-accessibility',
    kind: 'correctness',
    cmd: node('lint-source-rules.mjs', '--rule', 'selected-state-accessibility'),
    catches:
      'a chip or pill whose selection shows only as a tint, so a screen reader never hears which one is chosen',
  },
  {
    name: 'lint:no-geocoding',
    kind: 'correctness',
    cmd: node('lint-source-rules.mjs', '--rule', 'no-geocoding'),
    catches:
      'athlete coordinates sent to a geocoder, through the platform API, a geocoding host in TypeScript or the engine, or a geocoding module returning',
  },
  {
    name: 'lint:unused-i18n-keys',
    kind: 'style',
    cmd: node('lint-source-rules.mjs', '--rule', 'unused-i18n-keys'),
    catches: 'a locale key with no reader, left in all locales after the feature that used it went',
  },
  {
    name: 'lint:unused-styles',
    kind: 'correctness',
    cmd: node('lint-unused-styles.mjs'),
    catches: 'a StyleSheet key with no local or imported reader after a UI change',
  },
  {
    name: 'check:widget-theme',
    kind: 'correctness',
    cmd: tsx('gen-widget-theme.ts', '--check'),
    catches: 'the native widget theme drifting from the app tokens',
  },
  {
    name: 'lint:reachability',
    kind: 'style',
    cmd: node('reachability-audit.mjs'),
    catches: 'a module nothing imports, left behind after its caller went',
  },
  {
    name: 'lint:generated-typechecked',
    kind: 'correctness',
    cmd: node('lint-generated-typechecked.mjs'),
    catches:
      'a generated binding carrying @ts-nocheck, so a generator change that breaks a caller passes the typecheck',
  },
  {
    name: 'lint:engine-client-casts',
    kind: 'correctness',
    cmd: node('lint-engine-client-casts.mjs'),
    catches:
      'an engine call cast through unknown to a hand-written shape, so a renamed export or field passes the typecheck and fails on the device',
  },
  {
    name: 'lint:em-dashes',
    kind: 'style',
    cmd: node('lint-em-dashes.mjs'),
    catches: 'an em dash in prose or comments',
  },
  {
    name: 'lint:question-titles',
    kind: 'style',
    cmd: node('lint-question-titles.mjs'),
    catches:
      'a settings group header or info title phrased as a clause opening with a question word where a noun belongs',
  },
  {
    name: 'lint:comment-line-refs',
    kind: 'style',
    cmd: node('lint-comment-line-refs.mjs'),
    catches: 'a comment citing a line number, which drifts',
  },
  {
    name: 'lint:au-spelling',
    kind: 'style',
    cmd: node('lint-au-spelling.mjs'),
    catches: 'American spelling in our own identifiers and prose',
  },
  {
    name: 'lint:locale-overrides',
    kind: 'correctness',
    cmd: node('lint-locale-overrides.mjs'),
    catches: 'a copied regional string masking a later change to its base translation',
  },
  {
    name: 'lint:insight-valence',
    kind: 'correctness',
    cmd: node('lint-insight-valence.mjs'),
    catches: 'a punitive second-person insight string in the English base or regional copy',
  },
  {
    name: 'lint:audit-ids',
    kind: 'style',
    cmd: node('lint-audit-ids.mjs'),
    catches: 'a docket id in a comment, which rots',
  },
  {
    name: 'lint:exhaustive-deps-disables',
    kind: 'style',
    cmd: node('lint-exhaustive-deps-disables.mjs'),
    catches:
      'an exhaustive-deps disable with no stated reason for omitting a dependency, or any disable in an effect that rebuilds its list from a key',
  },
  {
    name: 'lint:feature-imports',
    kind: 'style',
    cmd: node('lint-feature-imports.mjs'),
    catches: 'a new deep import between features, past the recorded baseline',
  },
  {
    name: 'lint:window-dimensions',
    kind: 'style',
    cmd: node('lint-window-dimensions.mjs'),
    catches: 'a static Dimensions read that ignores rotation and split screen',
  },
  {
    name: 'lint:route-default-exports',
    kind: 'correctness',
    cmd: node('lint-route-default-exports.mjs'),
    catches:
      'a non-screen module under src/app registering as a route, so its link throws in a release build',
  },
  {
    name: 'lint:point-shape',
    kind: 'style',
    cmd: node('lint-point-shape.mjs'),
    catches:
      'a second lat/lng point declaration, which typechecks beside LatLngShort and ignores a change to it',
  },
  {
    name: 'lint:retired-names',
    kind: 'style',
    cmd: node('lint-retired-names.mjs'),
    catches:
      'the removed activity retention path coming back by name, in the store, the engine or the stream window comment',
  },
  {
    name: 'lint:verdict-palette',
    kind: 'style',
    cmd: node('lint-verdict-palette.mjs'),
    catches: 'a verdict colour outside the shared palette',
  },
  {
    name: 'lint:mark-contrast',
    kind: 'style',
    cmd: node('lint-mark-contrast.mjs'),
    catches:
      'success or warning used as a text, border or icon colour, below the contrast a mark needs',
  },
  {
    name: 'lint:press-feedback',
    kind: 'style',
    cmd: node('lint-press-feedback.mjs'),
    catches: 'a pressable with no pressed state',
  },
  {
    name: 'lint:rgba',
    kind: 'style',
    cmd: node('lint-rgba-literals.mjs'),
    catches: 'a colour literal outside the theme tokens',
  },
  {
    name: 'lint:unchecked-index',
    kind: 'style',
    cmd: node('lint-unchecked-index.mjs'),
    catches:
      'a new index read that can be undefined, in a directory whose count under noUncheckedIndexedAccess only falls',
  },
  {
    name: 'lint:hand-rolled-buttons',
    kind: 'style',
    cmd: node('lint-hand-rolled-buttons.mjs'),
    catches: 'a new hand-built button instead of the shared one',
  },
  {
    name: 'lint:roleless-pressables',
    kind: 'style',
    cmd: node('lint-roleless-pressables.mjs'),
    catches: 'a new press target outside the shared ui that a screen reader announces with no role',
  },
  {
    name: 'lint:untranslated-labels',
    kind: 'style',
    cmd: node('lint-untranslated-labels.mjs'),
    catches:
      'a new English sentence or accessibility label written into JSX, which reads in English whatever the app language is',
  },
  {
    name: 'lint:bash-empty-arrays',
    kind: 'correctness',
    cmd: node('lint-bash-empty-arrays.mjs'),
    catches:
      'an unguarded array expansion under set -u in a Maestro script, which passes on bash 5 and stops the suite on macOS bash 3.2',
  },
  {
    name: 'lint:native-header',
    kind: 'style',
    cmd: node('lint-source-rules.mjs', '--rule', 'native-header'),
    catches:
      'a screen drawing its own back button or header row, or the root stack turning the native header off',
  },
  {
    name: 'lint:ground-token-text',
    kind: 'style',
    cmd: node('lint-source-rules.mjs', '--rule', 'ground-token-text'),
    catches: 'a ground token colouring text, a hue that answers to no contrast bar',
  },
  {
    name: 'lint:dark-text-counterpart',
    kind: 'style',
    cmd: node('lint-source-rules.mjs', '--rule', 'dark-text-counterpart'),
    catches:
      'a text token the dark theme redefines, drawn in its light value in a file that switches on isDark',
  },
  {
    name: 'lint:widget-layouts',
    kind: 'correctness',
    cmd: node('lint-widget-layouts.mjs'),
    catches:
      'a widget layout where a match_parent child beside weighted columns squeezes them to 0 wide, leaving a card with one line',
  },
  {
    name: 'lint:module-link',
    kind: 'environment',
    cmd: node('lint-module-link.mjs'),
    catches:
      "node_modules/veloqrs pointing at a third tree, so a build anywhere ships that tree's engine",
  },
  {
    name: 'lint:worktree-config',
    kind: 'environment',
    cmd: node('lint-worktree-config.mjs'),
    catches: 'core.bare or user.email a leaked test fixture wrote onto the main checkout',
  },
  {
    name: 'lint:tracematch-clone',
    kind: 'environment',
    cmd: node('lint-tracematch-clone.mjs'),
    catches:
      "a worktree's tracematch tree shared with the main checkout, so one job commits another's detector edits",
  },
  {
    name: 'lint:cargo-config-reach',
    kind: 'environment',
    cmd: node('lint-cargo-config-reach.mjs'),
    catches: 'a worktree outside the directory whose cargo config caps jobs and names the corpus',
  },
];

const SETS = {
  commit: ['correctness'],
  land: ['correctness', 'style', 'environment', 'build'],
  all: ['correctness', 'style', 'environment', 'build'],
  environment: ['environment'],
};

// The whole-tree guards read the index, which is the tree under judgement in a
// hook and a stale base by hand: a build left unstaged would pass as its base.
function unstagedPaths() {
  const git = (...args) =>
    execFileSync('git', args, {
      env: gitFreeEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean);
  return [
    ...new Set([...git('diff', '--name-only'), ...git('ls-files', '-o', '--exclude-standard')]),
  ];
}

function run(guard) {
  return new Promise((resolve) => {
    const [bin, ...args] = guard.cmd;
    const started = Date.now();
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) => resolve({ guard, code, output, ms: Date.now() - started }));
    child.on('error', (error) => resolve({ guard, code: 127, output: String(error), ms: 0 }));
  });
}

async function runAll(guards, limit) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < guards.length) results.push(await run(guards[next++]));
  }
  await Promise.all(Array.from({ length: Math.min(limit, guards.length) }, worker));
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const set = argv.includes('--set') ? argv[argv.indexOf('--set') + 1] : 'all';
  if (!SETS[set]) {
    console.error(
      `run-guards: unknown set "${set}", expected one of ${Object.keys(SETS).join(', ')}`
    );
    process.exit(2);
  }
  const source = argv.includes('--guards')
    ? JSON.parse(readFileSync(argv[argv.indexOf('--guards') + 1], 'utf8'))
    : GUARDS;
  const guards = source.filter((g) => SETS[set].includes(g.kind));
  if (argv.includes('--json')) {
    console.log(JSON.stringify(guards, null, 2));
    return;
  }
  if (argv.includes('--list')) {
    for (const g of guards) console.log(`${g.kind.padEnd(12)} ${g.name.padEnd(26)} ${g.catches}`);
    return;
  }

  if (set === 'all') {
    const unstaged = unstagedPaths();
    if (unstaged.length > 0) {
      console.error(
        `run-guards: the guards read the index, so these would be judged as their base. git add them first:\n${unstaged.map((p) => `  ${p}`).join('\n')}`
      );
      process.exit(1);
    }
  }

  // Half the cores: the guards share the box with Jest, tsc and ESLint in the
  // same hook.
  const limit = Math.max(2, Math.floor(availableParallelism() / 2));
  const started = Date.now();
  const results = await runAll(guards, limit);
  const failed = results.filter((r) => r.code !== 0);
  for (const r of failed) {
    console.error(
      `\n--- ${r.guard.name} failed (${r.guard.kind}), guarding against ${r.guard.catches}`
    );
    process.stderr.write(r.output.endsWith('\n') ? r.output : `${r.output}\n`);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (failed.length > 0) {
    console.error(
      `\nrun-guards: ${failed.length} of ${results.length} ${set} guards failed in ${seconds} s`
    );
    process.exit(1);
  }
  console.log(`run-guards: ${results.length} ${set} guards passed in ${seconds} s`);
}

main();
