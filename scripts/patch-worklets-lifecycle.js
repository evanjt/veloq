#!/usr/bin/env node
// Reads `node_modules` on purpose: this patches the installed package, which is the
// environment and not a tracked file.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const FILES = [
  'android/src/networking/com/swmansion/worklets/WorkletsModule.java',
  'android/src/no-networking/com/swmansion/worklets/WorkletsModule.java',
];
const VERSION = '0.8.3';
const EXPECTED = {
  [FILES[0]]: 'ca59f21b3ffe9fc72a024f1db367f3c99eb1428a14d3992a0e07d278b0badafa',
  [FILES[1]]: '5a61cc85edc92b0e17b6a084a90adced1ee2091d6f50c100d0f320f74921570d',
};
const hash = (source) => createHash('sha256').update(source).digest('hex');
const FIELD = '  private final AtomicBoolean mLifecycleRegistered = new AtomicBoolean(false);\n';
const INIT = `  @Override
  public void initialize() {
    super.initialize();
    if (!mInvalidated.get() && mLifecycleRegistered.compareAndSet(false, true)) {
      getReactApplicationContext().addLifecycleEventListener(this);
    }
  }

`;
const REMOVE = `    if (mLifecycleRegistered.compareAndSet(true, false)) {
      getReactApplicationContext().removeLifecycleEventListener(this);
    }
`;
const FIELD_ANCHOR = '  private final AtomicBoolean mInvalidated = new AtomicBoolean(false);\n';
const INIT_ANCHOR = '  public void invalidate() {\n';
const REMOVE_ANCHOR = '    if (mInvalidated.getAndSet(true)) {\n      return;\n    }\n';

function replaceOnce(source, anchor, replacement) {
  if (source.indexOf(anchor) === -1 || source.indexOf(anchor) !== source.lastIndexOf(anchor)) {
    throw new Error('Worklets source changed');
  }
  return source.replace(anchor, replacement);
}

function patchOriginal(source) {
  let patched = replaceOnce(source, FIELD_ANCHOR, `${FIELD_ANCHOR}${FIELD}`);
  patched = replaceOnce(patched, INIT_ANCHOR, `${INIT}${INIT_ANCHOR}`);
  return replaceOnce(patched, REMOVE_ANCHOR, `${REMOVE_ANCHOR}${REMOVE}`);
}

function patchSource(source, expectedHash) {
  if (source.includes(FIELD) || source.includes(INIT) || source.includes(REMOVE)) {
    if (!source.includes(FIELD) || !source.includes(INIT) || !source.includes(REMOVE)) {
      throw new Error('Worklets source changed');
    }
    const original = source.replace(FIELD, '').replace(INIT, '').replace(REMOVE, '');
    if (hash(original) !== expectedHash || patchOriginal(original) !== source) {
      throw new Error('Worklets source changed');
    }
    return source;
  }
  if (hash(source) !== expectedHash) throw new Error('Worklets source changed');
  return patchOriginal(source);
}

function applyPatch(root, check = false, expected = EXPECTED) {
  const modules = path.join(root, 'node_modules');
  const entry = path.join(modules, 'react-native-worklets');
  if (!fs.existsSync(entry)) throw new Error('react-native-worklets is missing');
  const version = JSON.parse(fs.readFileSync(path.join(entry, 'package.json'), 'utf8')).version;
  if (version !== VERSION) throw new Error(`Worklets repair requires version ${VERSION}, found ${version}`);
  const changes = FILES.map((file) => {
    const original = fs.readFileSync(path.join(entry, file), 'utf8');
    return { file, original, patched: patchSource(original, expected[file]) };
  });
  if (check) {
    if (changes.some(({ original, patched }) => original !== patched)) {
      throw new Error('Worklets lifecycle repair is missing');
    }
    return;
  }
  if (changes.every(({ original, patched }) => original === patched)) return;
  if (fs.lstatSync(modules).isSymbolicLink()) {
    throw new Error('Worklets repair cannot write through a shared node_modules link');
  }
  if (fs.lstatSync(entry).isSymbolicLink()) {
    const copy = fs.mkdtempSync(path.join(modules, '.worklets-'));
    fs.cpSync(fs.realpathSync(entry), copy, { recursive: true });
    fs.unlinkSync(entry);
    fs.renameSync(copy, entry);
  }
  for (const { file, patched } of changes) fs.writeFileSync(path.join(entry, file), patched);
}

if (require.main === module) {
  try {
    applyPatch(process.cwd(), process.argv.includes('--check'));
  } catch (error) {
    console.error(`patch-worklets-lifecycle: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { patchSource, applyPatch };
