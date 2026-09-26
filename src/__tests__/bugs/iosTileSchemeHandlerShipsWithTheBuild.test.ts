/**
 * Scenario: an iOS map page asks for a tile on the page's own custom-scheme
 * origin, and something has to answer it out of the Rust-owned store.
 * `WKURLSchemeHandler` will not claim https, so the page loads on the scheme
 * the handler owns, and the handler reaches Rust through a C symbol rather
 * than JNI.
 *
 * Expected behaviour: the handler, the web view that registers it and the
 * manager that creates that view are our own Objective-C, compiled by our own
 * pod, and the three map mounts select the manager by the same name on both
 * platforms. The scheme, the component name and the C symbol are each written
 * in two languages, so each is checked to agree.
 */

import fs from 'fs';
import path from 'path';

import { VELOQ_WEBVIEW_COMPONENT_NAME } from '@/features/maps/lib/veloqWebView';
import { VELOQ_TILE_SCHEME } from '@/features/maps/lib/tileTransport';

const projectRoot = path.join(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(projectRoot, rel), 'utf8');

const IOS_SRC = 'modules/veloqrs/ios';
const HANDLER =
  read(`${IOS_SRC}/VeloqTileSchemeHandler.h`) + read(`${IOS_SRC}/VeloqTileSchemeHandler.m`);
const WEB_VIEW = read(`${IOS_SRC}/VeloqTileWebView.h`) + read(`${IOS_SRC}/VeloqTileWebView.m`);
const MANAGER = read(`${IOS_SRC}/VeloqWebViewManager.mm`);
const PODSPEC = read(`${IOS_SRC}/Veloqrs.podspec`);
const RUST_ENTRY = read('modules/veloqrs/rust/veloqrs/src/basemap/c.rs');
const RUST_MOD = read('modules/veloqrs/rust/veloqrs/src/basemap/mod.rs');

const MOUNTS = [
  'src/features/maps/components/MapSurface.tsx',
  'src/features/maps/components/Map3DWebView.tsx',
  'src/features/maps/components/TerrainSnapshotWebView.tsx',
];

describe('the scheme handler reaches the store through the symbol Rust exports', () => {
  it('calls the C entry by the name Rust gives it, and frees what it is given', () => {
    expect(HANDLER).toContain('<WKURLSchemeHandler>');
    expect(HANDLER).toContain('veloq_tile_get_or_fetch(');
    expect(HANDLER).toContain('veloq_tile_free(');
    expect(RUST_ENTRY).toContain('pub unsafe extern "C" fn veloq_tile_get_or_fetch(');
    expect(RUST_ENTRY).toContain('pub unsafe extern "C" fn veloq_tile_free(');
  });

  it('is compiled for every target, since the symbol is plain C', () => {
    expect(RUST_MOD).toMatch(/\nmod c;/);
    expect(RUST_MOD).not.toMatch(/#\[cfg\(target_os = "ios"\)\]\nmod c;/);
  });

  it('answers a tile path and refuses a malformed one', () => {
    expect(HANDLER).toContain('/veloq-tile/');
    expect(HANDLER).toMatch(/400/);
    expect(HANDLER).toMatch(/404/);
  });

  it('stops answering a task WebKit has stopped', () => {
    expect(HANDLER).toContain('stopURLSchemeTask');
  });

  it('does not log a string per tile', () => {
    expect(HANDLER).not.toContain('VTILE');
  });
});

describe('the web view registers the handler on the scheme the page loads on', () => {
  it('names the scheme the TypeScript side names', () => {
    expect(HANDLER).toContain(`VeloqTileScheme = @"${VELOQ_TILE_SCHEME}";`);
    expect(WEB_VIEW).toContain('forURLScheme:VeloqTileScheme]');
  });

  it('adds the handler to the configuration the library builds, and changes nothing else', () => {
    expect(WEB_VIEW).toContain(': RNCWebViewImpl');
    expect(WEB_VIEW).toContain('setUpWkWebViewConfig');
    expect(WEB_VIEW).toContain('[super setUpWkWebViewConfig]');
    expect(WEB_VIEW).toContain('setURLSchemeHandler:');
  });
});

describe('the view manager is the one the map mounts ask for', () => {
  it('names itself what the JavaScript side asks for', () => {
    expect(MANAGER).toContain(`RCT_EXPORT_MODULE(${VELOQ_WEBVIEW_COMPONENT_NAME})`);
  });

  it('creates our web view and inherits everything else', () => {
    expect(MANAGER).toContain(': RNCWebViewManager');
    expect(MANAGER).toContain('[[VeloqTileWebView alloc] init]');
  });

  it('can see the library it extends', () => {
    expect(PODSPEC).toContain('s.dependency "react-native-webview"');
  });
});

describe('every WebView the map draws into', () => {
  it.each(MOUNTS)('%s loads on the origin the transport names', (rel) => {
    const source = read(rel);
    expect(source).toContain('baseUrl: mapPageBaseUrl()');
    expect(source).not.toContain("'https://veloq.fit/'");
  });
});
