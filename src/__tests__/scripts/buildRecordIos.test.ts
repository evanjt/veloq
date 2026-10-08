/**
 * Scenario: an iOS app is installed to test a change. A build from a dirty
 * tree, with a bundle from an older build, or linked against a Rust archive
 * built from other Rust sources installs and runs without saying so.
 *
 * Expected behaviour: the build writes a record read out of the `.app` and the
 * archive linked beside it, and the installer installs only an app whose bundle and
 * archive match that record and whose inputs match the tree.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { build as buildApk, checkout, write } from '../__shared__/apkFixture';
import { ARCHIVE, LINKED_MANIFEST, buildApp } from '../__shared__/iosAppFixture';
import { buildStamp, sourceIdentity } from '../../../scripts/lib/build-stamp.js';

const ios = require('../../../scripts/lib/build-record-ios.js');

const EXPECT = { bundleId: 'com.veloq.app.dev', platform: 'iphonesimulator' };

describe('the iOS build record', () => {
  let root: string;
  let app: string;
  beforeEach(() => {
    root = checkout();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (app) fs.rmSync(path.dirname(app), { recursive: true, force: true });
  });

  function record(options = {}, variant = 'Release') {
    const snapshot = sourceIdentity(root);
    app = buildApp(root, options);
    return ios.writeRecord(root, app, { variant, snapshot });
  }
  const verify = (expect: Record<string, unknown> = {}) =>
    ios.verifyRecord(root, app, { ...EXPECT, ...expect });

  it('verifies an app against the tree and framework it was built from', () => {
    const written = record();

    expect(written.application).toEqual({
      id: 'com.veloq.app.dev',
      platform: 'iphonesimulator',
      config: { id: 'com.veloq.app.dev', name: 'Veloq Dev' },
      extensions: { VeloqWidget: 'com.veloq.app.dev.VeloqWidget' },
    });
    expect(written.archive.sdk).toBe('iphonesimulator');
    expect(written.archive.sources).toMatch(/^[0-9a-f]{64}$/);
    expect(verify().problems).toEqual([]);
  });

  it('refuses to record when the inputs changed while the build ran', () => {
    const snapshot = sourceIdentity(root);
    app = buildApp(root);
    write(root, 'src/app.ts', 'export const greeting = "edited mid-build";\n');

    expect(() => ios.writeRecord(root, app, { variant: 'Release', snapshot })).toThrow(/changed/);
  });

  it('refuses to record without a snapshot of the inputs', () => {
    app = buildApp(root);

    expect(() => ios.writeRecord(root, app, { variant: 'Release' })).toThrow(/snapshot/);
  });

  it('refuses a release app that embeds no bundle', () => {
    const snapshot = sourceIdentity(root);
    app = buildApp(root, { packagedBundle: null });

    expect(() => ios.writeRecord(root, app, { variant: 'Release', snapshot })).toThrow(/bundle/);
  });

  it('records a debug app, which Metro serves, with no embedded bundle', () => {
    const snapshot = sourceIdentity(root);
    app = buildApp(root, { packagedBundle: null });
    const written = ios.writeRecord(root, app, { variant: 'Debug', snapshot });

    expect(written.javascript.sha256).toBeNull();
    expect(verify().problems).toEqual([]);
  });

  it('refuses an app whose bundle was swapped after the record was written', () => {
    record();
    write(app, 'main.jsbundle', 'var app = "an older bundle";');

    expect(verify().problems.join('\n')).toMatch(/bundle/);
  });

  it('refuses another bundle identifier than the install asked for', () => {
    record({ bundleId: 'com.veloq.app' });

    expect(verify().problems.join('\n')).toMatch(/com\.veloq\.app\b/);
    expect(verify({ bundleId: 'com.veloq.app' }).problems).toEqual([]);
  });

  it('records a consistent Dev app and a consistent production app with their extensions', () => {
    const dev = record({
      extensions: {
        VeloqWidget: 'com.veloq.app.dev.VeloqWidget',
        VeloqPush: 'com.veloq.app.dev.VeloqPush',
      },
    });
    expect(dev.application.config).toEqual({ id: 'com.veloq.app.dev', name: 'Veloq Dev' });
    expect(dev.application.extensions).toEqual({
      VeloqPush: 'com.veloq.app.dev.VeloqPush',
      VeloqWidget: 'com.veloq.app.dev.VeloqWidget',
    });
    expect(verify().problems).toEqual([]);

    fs.rmSync(path.dirname(app), { recursive: true, force: true });
    record({ bundleId: 'com.veloq.app' });
    expect(verify({ bundleId: 'com.veloq.app' }).problems).toEqual([]);
  });

  it('refuses to record an app whose embedded configuration names another identifier', () => {
    const snapshot = sourceIdentity(root);
    app = buildApp(root, { bundleId: 'com.veloq.app', embeddedBundleId: 'com.veloq.app.dev' });

    expect(() => ios.writeRecord(root, app, { variant: 'Release', snapshot })).toThrow(
      /com\.veloq\.app\.dev/
    );
    expect(fs.existsSync(ios.recordPath(app))).toBe(false);
  });

  it('refuses a release app that embeds no Expo configuration', () => {
    const snapshot = sourceIdentity(root);
    app = buildApp(root);
    fs.rmSync(path.join(app, 'EXConstants.bundle'), { recursive: true });

    expect(() => ios.writeRecord(root, app, { variant: 'Release', snapshot })).toThrow(
      /no embedded Expo configuration/
    );
  });

  it('refuses to record an app whose extension carries the other identity', () => {
    const snapshot = sourceIdentity(root);
    app = buildApp(root, {
      bundleId: 'com.veloq.app',
      extensions: { VeloqWidget: 'com.veloq.app.dev.VeloqWidget' },
    });

    expect(() => ios.writeRecord(root, app, { variant: 'Release', snapshot })).toThrow(
      /VeloqWidget/
    );
  });

  it('refuses to record an app whose extension sits under another app', () => {
    const snapshot = sourceIdentity(root);
    app = buildApp(root, { extensions: { VeloqWidget: 'com.example.other.VeloqWidget' } });

    expect(() => ios.writeRecord(root, app, { variant: 'Release', snapshot })).toThrow(
      /VeloqWidget/
    );
  });

  it('refuses a recorded app whose embedded configuration was changed after', () => {
    record();
    write(
      app,
      'EXConstants.bundle/app.config',
      JSON.stringify({
        ios: { bundleIdentifier: 'com.veloq.app' },
        extra: { buildCommit: buildStamp(root) },
      })
    );

    expect(verify().problems.join('\n')).toMatch(/embedded Expo configuration/);
  });

  it('refuses an app linked against the archive of the other SDK', () => {
    const snapshot = sourceIdentity(root);
    app = buildApp(root, { archiveSdk: 'iphoneos', platform: 'iphonesimulator' });

    expect(() => ios.writeRecord(root, app, { variant: 'Release', snapshot })).toThrow(
      /iphonesimulator/
    );
  });

  it('refuses an archive swapped after the build', () => {
    record();
    write(path.join(path.dirname(app), 'Veloqrs'), ARCHIVE, 'a library from elsewhere');

    expect(verify().problems.join('\n')).toMatch(/archive/i);
  });

  it('refuses an archive whose manifest names other Rust sources', () => {
    const snapshot = sourceIdentity(root);
    app = buildApp(root, { sources: '0'.repeat(64) });

    expect(() => ios.writeRecord(root, app, { variant: 'Release', snapshot })).toThrow(
      /Rust sources/
    );
  });

  it('refuses an app whose linked archive was replaced by another build', () => {
    record();
    const linked = path.join(path.dirname(app), 'Veloqrs');
    const manifest = JSON.parse(fs.readFileSync(path.join(linked, LINKED_MANIFEST), 'utf8'));
    write(linked, LINKED_MANIFEST, JSON.stringify({ ...manifest, features: ['synthetic'] }));

    expect(verify().problems.join('\n')).toMatch(/not the one the app was built with/);
  });

  it('refuses an app with no linked archive beside it', () => {
    const snapshot = sourceIdentity(root);
    app = buildApp(root);
    fs.rmSync(path.join(path.dirname(app), 'Veloqrs'), { recursive: true });

    expect(() => ios.writeRecord(root, app, { variant: 'Release', snapshot })).toThrow(
      /no archive manifest/
    );
  });

  it('refuses an app after an input edit', () => {
    record();
    write(root, 'src/app.ts', 'export const greeting = "edited after";\n');

    expect(verify().problems.join('\n')).toMatch(/inputs/);
  });

  it('refuses an app with no record', () => {
    app = buildApp(root);

    expect(verify().problems.join('\n')).toMatch(/no build record/);
  });
});

describe('the identity an artifact carries', () => {
  const artifactIdentity = (file: string) =>
    require('../../../scripts/lib/artifact-identity.js').artifactIdentity(file);
  let root: string;
  beforeEach(() => {
    root = checkout();
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('reads the native, embedded and extension identities of an app and of its ipa', () => {
    const app = buildApp(root, {
      bundleId: 'com.veloq.app',
      embeddedBundleId: 'com.veloq.app.dev',
    });
    const parent = path.dirname(app);
    const expected = {
      native: 'com.veloq.app',
      embedded: { id: 'com.veloq.app.dev', name: 'Veloq' },
      extensions: { VeloqWidget: 'com.veloq.app.VeloqWidget' },
    };
    expect(artifactIdentity(app)).toEqual(expected);

    fs.mkdirSync(path.join(parent, 'Payload'));
    fs.renameSync(app, path.join(parent, 'Payload', 'Veloq.app'));
    const ipa = path.join(parent, 'Veloq.ipa');
    execFileSync('zip', ['-qr', ipa, 'Payload'], { cwd: parent });
    expect(artifactIdentity(ipa)).toEqual(expected);
    fs.rmSync(parent, { recursive: true, force: true });
  });

  it('reads the manifest package and the embedded configuration of an APK', () => {
    const apk = buildApk(root, {
      applicationId: 'com.veloq.app',
      configPackage: 'com.veloq.app.dev',
    });

    expect(artifactIdentity(apk)).toEqual({
      native: 'com.veloq.app',
      embedded: { id: 'com.veloq.app.dev', name: 'Veloq' },
      extensions: {},
    });
  });
});
