#!/usr/bin/env node
// Refuses an installed react-native-webview whose private hooks are not the
// ones the tile transport overrides.
//
// Two overrides reach into the library past its published surface. On iOS,
// `VeloqTileWebView.m` overrides `setUpWkWebViewConfig`, which the library
// declares in no header, to register the tile scheme handler. On Android,
// `VeloqWebViewManager.java` overrides `addEventEmitters` without calling
// super, to install the tile client in place of the library's. A release that
// renames the first, or changes what the second sets up, still compiles: the
// override is simply never called, or skips whatever the library added, and
// tiles stop resolving or the render process crash handler is lost.
//
// So this pins the installed and declared version, checks the iOS hook is
// still defined and called and the iOS manager is still a legacy view manager
// the interop layer can mount, and hashes the Android method so any edit to it
// stops the build until someone reads it. An upgrade updates the constants
// here deliberately, after checking both platforms load tiles.
//
// Reads `node_modules` on purpose: the installed package is what ships.
//
// Usage: node scripts/check-webview-hooks.mjs [--root DIR]

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { trackedText } from './lib/indexedSources.mjs';

const PACKAGE = 'react-native-webview';
const VERSION = '13.16.1';
const IMPL = 'apple/RNCWebViewImpl.m';
const MANAGER_HEADER = 'apple/RNCWebViewManager.h';
const MANAGER = 'android/src/newarch/com/reactnativecommunity/webview/RNCWebViewManager.java';
const CONFIG_DEFINITION = '- (WKWebViewConfiguration *)setUpWkWebViewConfig\n';
const CONFIG_CALL = '[self setUpWkWebViewConfig]';
const LEGACY_MANAGER = '@interface RNCWebViewManager : RCTViewManager';
const EMITTERS_SIGNATURE =
  'protected void addEventEmitters(@NonNull ThemedReactContext reactContext, RNCWebViewWrapper view)';
const EMITTERS_HASH = 'bb3d00c42c886a429b57b131678e710a97e82808e182139a38bd063f1738da14';

const rootArg = process.argv.indexOf('--root');
const root = resolve(rootArg < 0 ? '.' : process.argv[rootArg + 1]);
const entry = join(root, 'node_modules', PACKAGE);

const count = (text, needle) => text.split(needle).length - 1;
const hash = (text) => createHash('sha256').update(text).digest('hex');

/** The method from its signature to its matching closing brace, or null. */
function methodText(source, signature) {
  const start = source.indexOf(signature);
  if (start === -1 || source.indexOf(signature, start + 1) !== -1) return null;
  const open = source.indexOf('{', start + signature.length);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  return null;
}

function problems() {
  const found = [];
  const read = (file) => {
    try {
      return readFileSync(join(entry, file), 'utf8');
    } catch {
      found.push(`${PACKAGE}/${file} is not installed`);
      return null;
    }
  };

  const manifest = read('package.json');
  if (manifest === null) return found;
  const installed = JSON.parse(manifest).version;
  if (installed !== VERSION) {
    found.push(
      `${PACKAGE} ${installed} is installed; the tile overrides were checked against ${VERSION}`
    );
  }
  const declared = JSON.parse(trackedText(root, 'package.json') ?? '{}').dependencies?.[PACKAGE];
  if (declared !== VERSION) {
    found.push(`package.json declares ${PACKAGE} ${declared}; it must pin ${VERSION} exactly`);
  }

  const impl = read(IMPL);
  if (impl !== null) {
    if (count(impl, CONFIG_DEFINITION) !== 1) {
      found.push(`${IMPL} no longer defines setUpWkWebViewConfig returning the configuration`);
    }
    if (count(impl, CONFIG_CALL) < 1) {
      found.push(`${IMPL} no longer calls setUpWkWebViewConfig to build the web view`);
    }
  }

  const header = read(MANAGER_HEADER);
  if (header !== null && !header.includes(LEGACY_MANAGER)) {
    found.push(`${MANAGER_HEADER} no longer declares an RCTViewManager the interop layer mounts`);
  }

  const manager = read(MANAGER);
  if (manager !== null) {
    const method = methodText(manager, EMITTERS_SIGNATURE);
    if (method === null) {
      found.push(
        `${MANAGER} no longer has exactly one addEventEmitters with the overridden signature`
      );
    } else if (hash(method) !== EMITTERS_HASH) {
      found.push(
        `${MANAGER} addEventEmitters changed (sha256 ${hash(method)}); the override skips it and must match`
      );
    }
  }
  return found;
}

const found = problems();
if (found.length > 0) {
  for (const problem of found) console.error(`check-webview-hooks: ${problem}`);
  process.exit(1);
}
