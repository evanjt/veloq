#!/usr/bin/env node
// Reads `node_modules` on purpose: this patches the installed package, which is the
// environment and not a tracked file.
//
// Material's sheet behaviour hands a drag to its content only through one view, the first
// depth first that scrolls nested, and it looks for that view only when the sheet is laid
// out. React Native lays a sheet's content out without laying the sheet out, so a card pushed
// into a map sheet, a pager page changed inside one, or a body mounted after a loading state
// leaves the behaviour holding the view it found before: a covered card moved out of view, or
// one already gone. Every drag then starts outside that view and the sheet takes it, so at the
// sheet's top stop the card on show does not scroll at all. This finds the view again as each
// touch starts, before the behaviour reads it.
//
// The behaviour keeps that view in a package-private field, so the finder is a class in
// Material's package compiled into this library. A Material release that renames the field
// fails the build rather than the gesture.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const FILE =
  'android/src/main/java/com/swmansion/rnscreens/stack/views/ScreensCoordinatorLayout.kt';
const FINDER_FILE =
  'android/src/main/java/com/google/android/material/bottomsheet/SheetScrollingChild.java';
const VERSION = '4.30.0';
const EXPECTED = '5dc4c64bdebedb3de9a705d2914244bb25b0e21a0281e39892bbc67d2ecfa104';
const hash = (source) => createHash('sha256').update(source).digest('hex');

const FINDER_SOURCE = `package com.google.android.material.bottomsheet;

import android.view.View;
import java.lang.ref.WeakReference;

/** Finds a sheet's scrolling child again, which the behaviour otherwise does only at layout. */
public final class SheetScrollingChild {
    private SheetScrollingChild() {}

    public static void refresh(BottomSheetBehavior<?> behavior, View sheet) {
        behavior.nestedScrollingChildRef = new WeakReference<>(behavior.findScrollingChild(sheet));
    }
}
`;

/** Each edit as the package ships the lines and as the patch leaves them. */
const EDITS = [
  [
    'import android.content.Context\n',
    'import android.content.Context\nimport android.view.MotionEvent\n',
  ],
  [
    'import androidx.coordinatorlayout.widget.CoordinatorLayout\n',
    'import androidx.coordinatorlayout.widget.CoordinatorLayout\n' +
      'import com.google.android.material.bottomsheet.SheetScrollingChild\n',
  ],
  [
    `    override fun shouldDelayChildPressedState(): Boolean = fragment.screen.usesFormSheetPresentation()
`,
    `    override fun shouldDelayChildPressedState(): Boolean = fragment.screen.usesFormSheetPresentation()

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
        if (ev.actionMasked == MotionEvent.ACTION_DOWN) {
            fragment.screen.sheetBehavior?.let { SheetScrollingChild.refresh(it, fragment.screen) }
        }
        return super.onInterceptTouchEvent(ev)
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
    throw new Error(`Screens sheet scroll patch requires version ${VERSION}, found ${version}`);
  }
  const original = fs.readFileSync(path.join(entry, FILE), 'utf8');
  const patched = patchSource(original, expectedHash);
  const finder = path.join(entry, FINDER_FILE);
  const finderDone = fs.existsSync(finder) && fs.readFileSync(finder, 'utf8') === FINDER_SOURCE;
  if (check) {
    if (original !== patched || !finderDone) {
      throw new Error('Screens sheet scroll patch is missing');
    }
    return;
  }
  if (original === patched && finderDone) return;
  if (fs.lstatSync(modules).isSymbolicLink()) {
    throw new Error('Screens patch cannot write through a shared node_modules link');
  }
  if (fs.lstatSync(entry).isSymbolicLink()) {
    const copy = fs.mkdtempSync(path.join(modules, '.screens-'));
    fs.cpSync(fs.realpathSync(entry), copy, { recursive: true });
    fs.unlinkSync(entry);
    fs.renameSync(copy, entry);
  }
  fs.mkdirSync(path.dirname(finder), { recursive: true });
  fs.writeFileSync(finder, FINDER_SOURCE);
  fs.writeFileSync(path.join(entry, FILE), patched);
}

if (require.main === module) {
  try {
    applyPatch(process.cwd(), process.argv.includes('--check'));
  } catch (error) {
    console.error(`patch-screens-sheet-scroll: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  patchSource,
  unpatchSource,
  applyPatch,
  FILE,
  FINDER_FILE,
  FINDER_SOURCE,
  VERSION,
};
