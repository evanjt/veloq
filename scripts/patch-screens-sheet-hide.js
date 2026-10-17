#!/usr/bin/env node
// Reads `node_modules` on purpose: this patches the installed package, which is the
// environment and not a tracked file.
//
// react-native-screens makes every Android form sheet hideable, so a drag below its lowest
// detent dismisses the sheet's route whatever the route asked for. iOS keeps a sheet whose
// route sets `gestureEnabled: false` on screen. This gives Android the same rule: a sheet is
// hideable by drag only while its screen allows the dismiss gesture, so a sheet that rests
// over a map stops at its lowest detent. Back and a navigation call still close it.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const FILE = 'android/src/main/java/com/swmansion/rnscreens/bottomsheet/SheetDelegate.kt';
const VERSION = '4.28.0';
const EXPECTED = '6fa84feaed18a2751d12951e88a67aa35234f0bd9e70474b05f3a7f1dff70029';
const hash = (source) => createHash('sha256').update(source).digest('hex');

const SHIPPED = `        behavior.apply {
            isHideable = true
            isDraggable = true
        }
`;
const PATCHED = `        behavior.apply {
            isHideable = screen.isGestureEnabled
            isDraggable = true
        }
`;

function replaceOnce(source, from, to) {
  const at = source.indexOf(from);
  if (at === -1 || at !== source.lastIndexOf(from)) throw new Error('Screens source changed');
  return source.slice(0, at) + to + source.slice(at + from.length);
}

/** The source with the patch taken out, which is what the package ships. */
function unpatchSource(source) {
  return source.includes(PATCHED) ? source.replace(PATCHED, SHIPPED) : source;
}

function patchSource(source, expectedHash = EXPECTED) {
  if (hash(source) === expectedHash) return replaceOnce(source, SHIPPED, PATCHED);
  const original = unpatchSource(source);
  if (hash(original) !== expectedHash || replaceOnce(original, SHIPPED, PATCHED) !== source) {
    throw new Error('Screens source changed');
  }
  return source;
}

function applyPatch(root, check = false, expectedHash = EXPECTED) {
  const modules = path.join(root, 'node_modules');
  const entry = path.join(modules, 'react-native-screens');
  if (!fs.existsSync(entry)) throw new Error('react-native-screens is missing');
  const version = JSON.parse(fs.readFileSync(path.join(entry, 'package.json'), 'utf8')).version;
  if (version !== VERSION) {
    throw new Error(`Screens sheet hide patch requires version ${VERSION}, found ${version}`);
  }
  const original = fs.readFileSync(path.join(entry, FILE), 'utf8');
  const patched = patchSource(original, expectedHash);
  if (check) {
    if (original !== patched) throw new Error('Screens sheet hide patch is missing');
    return;
  }
  if (original === patched) return;
  if (fs.lstatSync(modules).isSymbolicLink()) {
    throw new Error('Screens patch cannot write through a shared node_modules link');
  }
  if (fs.lstatSync(entry).isSymbolicLink()) {
    const copy = fs.mkdtempSync(path.join(modules, '.screens-'));
    fs.cpSync(fs.realpathSync(entry), copy, { recursive: true });
    fs.unlinkSync(entry);
    fs.renameSync(copy, entry);
  }
  fs.writeFileSync(path.join(entry, FILE), patched);
}

if (require.main === module) {
  try {
    applyPatch(process.cwd(), process.argv.includes('--check'));
  } catch (error) {
    console.error(`patch-screens-sheet-hide: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { patchSource, unpatchSource, applyPatch, FILE, VERSION };
