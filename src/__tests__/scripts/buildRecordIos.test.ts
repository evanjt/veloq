/**
 * Scenario: an iOS app is installed to test a change. A build from a dirty
 * tree, with a bundle from an older build, or linked against a Rust archive
 * built from other Rust sources installs and runs without saying so.
 *
 * Expected behaviour: the build writes a record read out of the `.app` and the
 * archive linked beside it, and the installer installs only an app whose bundle and
 * archive match that record and whose inputs match the tree.
 */
import * as fs from 'fs';
import * as path from 'path';

import { checkout, write } from '../__shared__/apkFixture';
import { ARCHIVE, LINKED_MANIFEST, buildApp } from '../__shared__/iosAppFixture';
import { sourceIdentity } from '../../../scripts/lib/build-stamp.js';

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

    expect(written.application).toEqual({ id: 'com.veloq.app.dev', platform: 'iphonesimulator' });
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
