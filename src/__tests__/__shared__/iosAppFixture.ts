/**
 * A checkout and the `.app` an iOS build produces from it, for the suites that
 * judge an app by its build record: the directory the Rust build phase links
 * `libveloqrs_ffi.a` from, with the manifest of the selection it was copied
 * from, beside an app directory holding an Info.plist, an embedded bundle and
 * the Expo constants.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { sha256, write } from './apkFixture';

const { buildStamp } = require('../../../scripts/lib/build-stamp.js');
const { hashRustInputs } = require('../../../modules/veloqrs/scripts/rust-inputs.js');

const ARCHIVE = 'libveloqrs_ffi.a';
const LINKED_MANIFEST = 'libveloqrs_ffi.manifest.json';

export interface IosBuildOptions {
  bundleId?: string;
  platform?: 'iphonesimulator' | 'iphoneos';
  /** The SDK the linked archive was built for, the app's own when unset. */
  archiveSdk?: string;
  /** The Rust sources the linked archive's manifest names. */
  sources?: string;
  bundle?: string;
  packagedBundle?: string | null;
  profile?: string;
  features?: string[];
}

function plist(bundleId: string, platform: string) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<plist version="1.0"><dict>',
    `<key>CFBundleIdentifier</key><string>${bundleId}</string>`,
    `<key>DTPlatformName</key><string>${platform}</string>`,
    '</dict></plist>',
  ].join('\n');
}

/** What the Rust build phase leaves beside the linked archive, and the app Xcode links it into. */
export function buildApp(root: string, options: IosBuildOptions = {}) {
  const platform = options.platform ?? 'iphonesimulator';
  const profile = options.profile ?? 'release';
  const features = options.features ?? [];
  const sources = options.sources ?? hashRustInputs(path.join(root, 'modules/veloqrs/rust'));
  const sdk = options.archiveSdk ?? platform;

  const archive = Buffer.from(`static library for ${sdk}`);
  const manifest = JSON.stringify({
    fingerprint: sha256(`${sdk}:${sources}`),
    sources,
    platform: 'ios',
    targets: [`${sdk}:arm64`],
    profile,
    features,
    files: { [ARCHIVE]: sha256(archive) },
  });

  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-ios-'));
  const linked = path.join(parent, 'Veloqrs');
  write(linked, ARCHIVE, archive);
  write(linked, LINKED_MANIFEST, manifest);

  const app = path.join(parent, 'Veloq.app');
  write(
    app,
    'Info.plist',
    plist(options.bundleId ?? 'com.veloq.app.dev', options.platform ?? 'iphonesimulator')
  );
  write(app, 'Veloq', 'executable');
  if (options.packagedBundle !== null) {
    write(app, 'main.jsbundle', options.packagedBundle ?? options.bundle ?? 'var app = "hello";');
  }
  write(
    app,
    'EXConstants.bundle/app.config',
    JSON.stringify({ extra: { buildCommit: buildStamp(root) } })
  );
  return app;
}

export { ARCHIVE, LINKED_MANIFEST };
