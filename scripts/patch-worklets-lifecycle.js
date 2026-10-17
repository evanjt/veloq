#!/usr/bin/env node
// Reads `node_modules` on purpose: this patches the installed package, which is the
// environment and not a tracked file.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const FILES = [
  'android/src/networking/com/swmansion/worklets/WorkletsModule.kt',
  'android/src/no-networking/com/swmansion/worklets/WorkletsModule.kt',
];
const VERSION = '0.10.1';
const EXPECTED = {
  [FILES[0]]: '5fb1c7203fc5a119b2364c9ebae937d0a18538b676de3f240633c1a0d9d15720',
  [FILES[1]]: '0c68aa5db3aebad144786f10da32eef94d24b2d92a6a648ef9dfa502b3341808',
};
const hash = (source) => createHash('sha256').update(source).digest('hex');
const FIELD = '    private val mLifecycleRegistered = AtomicBoolean(false)\n';
const INIT = `    override fun initialize() {
        super.initialize()
        if (!mInvalidated.get() && mLifecycleRegistered.compareAndSet(false, true)) {
            reactApplicationContext.addLifecycleEventListener(this)
        }
    }

`;
const REMOVE = `        if (mLifecycleRegistered.compareAndSet(true, false)) {
            reactApplicationContext.removeLifecycleEventListener(this)
        }
`;
const FIELD_ANCHOR = '    private val mInvalidated = AtomicBoolean(false)\n';
const INIT_ANCHOR = '    override fun invalidate() {\n';
const REMOVE_ANCHOR =
  '        if (mInvalidated.getAndSet(true)) {\n            return\n        }\n';

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

/** The source with the repair taken out, which is what the package ships. */
function unpatchSource(source) {
  return source.replace(FIELD, '').replace(INIT, '').replace(REMOVE, '');
}

function patchSource(source, expectedHash) {
  if (source.includes(FIELD) || source.includes(INIT) || source.includes(REMOVE)) {
    if (!source.includes(FIELD) || !source.includes(INIT) || !source.includes(REMOVE)) {
      throw new Error('Worklets source changed');
    }
    const original = unpatchSource(source);
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
  if (version !== VERSION)
    throw new Error(`Worklets repair requires version ${VERSION}, found ${version}`);
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

module.exports = { patchSource, unpatchSource, applyPatch, FILES };
