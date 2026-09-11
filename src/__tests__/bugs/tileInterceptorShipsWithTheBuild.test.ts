/**
 * Scenario: someone clones the repository, runs `npm ci` and builds. The map
 * page asks for `/veloq-tile/<source>/<z>/<x>/<y>` and something has to answer
 * it out of the Rust-owned store.
 *
 * Expected behaviour: the interceptor is our own code, compiled from our own
 * module, reached by an ordinary import. It used to live only in
 * `patches/react-native-webview+tile-intercept.patch`, which nothing applied,
 * so a clean install drew no map. The client is attached by our own view
 * manager, and the three map mounts select that manager by name through
 * `nativeConfig`, so the name is the one thing that has to agree on both sides.
 */

import fs from 'fs';
import path from 'path';

import { VELOQ_WEBVIEW_COMPONENT_NAME } from '@/features/maps/lib/veloqWebView';

const projectRoot = path.join(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(projectRoot, rel), 'utf8');

const ANDROID_SRC = 'modules/veloqrs/android/src/main/java/com/veloq';
const CLIENT = read(`${ANDROID_SRC}/VeloqTileWebViewClient.java`);
const MANAGER = read(`${ANDROID_SRC}/VeloqWebViewManager.java`);
const PACKAGE = read(`${ANDROID_SRC}/VeloqrsPackage.kt`);
const GRADLE = read('modules/veloqrs/android/build.gradle');

const MOUNTS = [
  'src/features/maps/components/MapSurface.tsx',
  'src/features/maps/components/Map3DWebView.tsx',
  'src/features/maps/components/TerrainSnapshotWebView.tsx',
];

describe('the tile interceptor is compiled, not patched in', () => {
  it('carries no patch directory', () => {
    expect(fs.existsSync(path.join(projectRoot, 'patches'))).toBe(false);
  });

  it('reaches TileBridge directly rather than by reflection', () => {
    expect(CLIENT).toContain('package com.veloq;');
    expect(CLIENT).toContain('TileBridge.getOrFetch(');
    expect(CLIENT).not.toContain('Class.forName');
    expect(CLIENT).not.toContain('java.lang.reflect');
  });

  it('answers a tile path and refuses a malformed one', () => {
    expect(CLIENT).toContain('extends RNCWebViewClient');
    expect(CLIENT).toContain('shouldInterceptRequest');
    expect(CLIENT).toContain('/veloq-tile/');
    expect(CLIENT).toMatch(/400/);
    expect(CLIENT).toMatch(/404/);
  });

  it('does not log a string per tile', () => {
    expect(CLIENT).not.toContain('VTILE');
  });
});

describe('the view manager is the one the map mounts ask for', () => {
  it('names itself what the JavaScript side asks for', () => {
    expect(MANAGER).toContain(`String NAME = "${VELOQ_WEBVIEW_COMPONENT_NAME}";`);
    expect(MANAGER).toContain('return NAME;');
  });

  it('attaches our client and inherits everything else', () => {
    expect(MANAGER).toContain('extends RNCWebViewManager');
    expect(MANAGER).toContain('new VeloqTileWebViewClient()');
  });

  it('is registered by the package that already carries TileBridge', () => {
    expect(PACKAGE).toContain('createViewManagers');
    expect(PACKAGE).toContain('VeloqWebViewManager()');
  });

  it('can see the library it extends', () => {
    expect(GRADLE).toContain("project(':react-native-webview')");
  });
});

describe('every WebView the map draws into', () => {
  it.each(MOUNTS)('%s selects the veloq component', (rel) => {
    const source = read(rel);
    expect(source).toContain('veloqWebViewNativeConfig');
    expect(source).toContain('nativeConfig={veloqWebViewNativeConfig}');
  });

  it('mounts as many WebViews as it configures', () => {
    for (const rel of MOUNTS) {
      const source = read(rel);
      const mounts = source.match(/<WebView\s*\n/g) ?? [];
      const configured = source.match(/nativeConfig=\{veloqWebViewNativeConfig\}/g) ?? [];
      expect(configured).toHaveLength(mounts.length);
    }
  });
});
