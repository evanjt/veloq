#!/usr/bin/env node
// Reads `node_modules` on purpose: this patches the installed package, which is the
// environment and not a tracked file.
//
// react-native-screens builds an Android form sheet's behaviour with Material's
// no-argument `BottomSheetBehavior`, which has no maximum width, and gives the sheet no
// gravity. On a window wider than 640 dp the sheet then spans the window from the left
// edge. The cap belongs to the native sheet, since its surface, corners and scrim are
// drawn there, so this gives the behaviour Material's 640 dp modal width and centres the
// sheet. A window under 640 dp, a phone in portrait, lays out as before.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const FILE = 'android/src/main/java/com/swmansion/rnscreens/ScreenStackFragment.kt';
const VERSION = '4.28.0';
const EXPECTED = 'bc1e41a12139946bdd11aa502486df93c1d75fb05f6fd5463946a10044d38bcb';
const hash = (source) => createHash('sha256').update(source).digest('hex');

/** Each edit as the package ships the lines and as the patch leaves them. */
const EDITS = [
  ['import android.os.Bundle\n', 'import android.os.Bundle\nimport android.view.Gravity\n'],
  [
    `                ).apply {
                    behavior =
`,
    `                ).apply {
                    if (screen.usesFormSheetPresentation()) {
                        gravity = Gravity.CENTER_HORIZONTAL
                    }
                    behavior =
`,
  ],
  [
    `    private fun createBottomSheetBehaviour(): BottomSheetBehavior<Screen> = BottomSheetBehavior<Screen>()
`,
    `    private fun createBottomSheetBehaviour(): BottomSheetBehavior<Screen> =
        BottomSheetBehavior<Screen>().apply {
            maxWidth = PixelUtil.toPixelFromDIP(640f).toInt()
        }
`,
  ],
];

function replaceOnce(source, from, to) {
  const at = source.indexOf(from);
  if (at === -1 || at !== source.lastIndexOf(from)) throw new Error('Screens source changed');
  return source.slice(0, at) + to + source.slice(at + from.length);
}

function patchOriginal(source) {
  return EDITS.reduce((text, [shipped, patched]) => replaceOnce(text, shipped, patched), source);
}

/** The source with the patch taken out, which is what the package ships. */
function unpatchSource(source) {
  return EDITS.reduce(
    (text, [shipped, patched]) => (text.includes(patched) ? text.replace(patched, shipped) : text),
    source
  );
}

function patchSource(source, expectedHash = EXPECTED) {
  if (hash(source) === expectedHash) return patchOriginal(source);
  const original = unpatchSource(source);
  if (hash(original) !== expectedHash || patchOriginal(original) !== source) {
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
    throw new Error(`Screens sheet width patch requires version ${VERSION}, found ${version}`);
  }
  const original = fs.readFileSync(path.join(entry, FILE), 'utf8');
  const patched = patchSource(original, expectedHash);
  if (check) {
    if (original !== patched) throw new Error('Screens sheet width patch is missing');
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
    console.error(`patch-screens-sheet-width: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { patchSource, unpatchSource, applyPatch, FILE, VERSION };
