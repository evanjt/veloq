// Fails when a Maestro flow is not valid YAML or names a command Maestro lacks.
//
// Maestro reads every file under .maestro before it runs the first flow, so one
// that does not parse, or uses a command it does not know, stops the whole suite
// on both platforms with no flow named.
// The E2E gate only runs after a push to main, which is a week away from the
// commit that broke it when pushes are that far apart.

import { join, relative, resolve } from 'node:path';

import { loadAll } from 'js-yaml';

import { treeView } from './lib/indexedSources.mjs';

// Commands of the pinned Maestro CLI. Extend it when the pin moves.
const COMMANDS = new Set([
  'addMedia',
  'assertNoDefectsWithAI',
  'assertNotVisible',
  'assertScreenshot',
  'assertTrue',
  'assertVisible',
  'assertWithAI',
  'back',
  'clearKeychain',
  'clearState',
  'copyTextFrom',
  'doubleTapOn',
  'eraseText',
  'evalScript',
  'extendedWaitUntil',
  'extractTextWithAI',
  'hideKeyboard',
  'inputRandomEmail',
  'inputRandomNumber',
  'inputRandomPersonName',
  'inputRandomText',
  'inputText',
  'killApp',
  'launchApp',
  'longPressOn',
  'openBrowser',
  'openLink',
  'pasteText',
  'pressKey',
  'repeat',
  'retry',
  'runFlow',
  'runScript',
  'scroll',
  'scrollUntilVisible',
  'setAirplaneMode',
  'setLocation',
  'setOrientation',
  'setPermissions',
  'startRecording',
  'stopApp',
  'stopRecording',
  'swipe',
  'takeScreenshot',
  'tapOn',
  'toggleAirplaneMode',
  'travel',
  'waitForAnimationToEnd',
]);

// Commands Maestro runs only on Android. On iOS one aborts the run, and with it the
// gate's record, so a flow the iOS gate selects may use one only inside a
// `runFlow` conditioned on `platform: Android`.
const ANDROID_ONLY = new Set(['setAirplaneMode', 'toggleAirplaneMode']);

// The tags scripts/ios-gate-remote.sh passes to --include-tags.
const IOS_GATE_TAGS = new Set(['tier0', 'pack-map', 'pack-nav']);

export function androidOnlyCommands(docs) {
  const found = [];
  const walk = (list) => {
    for (const item of list ?? []) {
      const entries = typeof item === 'string' ? [[item, null]] : Object.entries(item ?? {});
      for (const [name, args] of entries) {
        if (ANDROID_ONLY.has(name)) found.push(name);
        if (args && Array.isArray(args.commands) && args.when?.platform !== 'Android') {
          walk(args.commands);
        }
      }
    }
  };
  const body = docs[docs.length - 1];
  if (Array.isArray(body)) walk(body);
  return found;
}

export function selectedByIosGate(docs) {
  const tags = docs.length > 1 ? docs[0]?.tags : null;
  return Array.isArray(tags) && tags.some((tag) => IOS_GATE_TAGS.has(tag));
}

export function unknownCommands(docs) {
  const found = [];
  const walk = (list) => {
    for (const item of list ?? []) {
      if (typeof item === 'string') {
        if (!COMMANDS.has(item)) found.push(item);
      } else if (item && typeof item === 'object') {
        for (const [name, args] of Object.entries(item)) {
          if (!COMMANDS.has(name)) found.push(name);
          if (args && Array.isArray(args.commands)) walk(args.commands);
        }
      }
    }
  };
  const body = docs[docs.length - 1];
  if (Array.isArray(body)) walk(body);
  return found;
}

const rootArg = process.argv.indexOf('--root');
const root = resolve(rootArg < 0 ? '.' : process.argv[rootArg + 1]);
const tree = treeView(root, ['.maestro']);

const flows = tree.files(join(root, '.maestro'), (rel) => /\.ya?ml$/.test(rel));
if (flows.length === 0) {
  console.error('check-maestro-flows: no YAML files under .maestro, so nothing was checked');
  process.exit(1);
}

const failures = [];
for (const file of flows) {
  try {
    const docs = loadAll(tree.text(file));
    for (const name of unknownCommands(docs)) {
      failures.push(`${relative(root, file)}: Maestro has no command ${name}`);
    }
    if (selectedByIosGate(docs)) {
      for (const name of androidOnlyCommands(docs)) {
        failures.push(
          `${relative(root, file)}: ${name} is Android-only, and the iOS gate selects this flow`
        );
      }
    }
  } catch (error) {
    failures.push(`${relative(root, file)}: ${error.message.split('\n')[0]}`);
  }
}

if (failures.length > 0) {
  console.error(`check-maestro-flows: ${failures.length} flow file(s) do not parse:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`check-maestro-flows: ${flows.length} flow files parse`);
