/**
 * Scenario: an APK is installed to test a change, and the commit it names is
 * all anyone checks. Two builds off one dirty tree name the same commit, a
 * submodule edit names nothing, and the bundle and the Rust library Gradle
 * packaged can be older than the configuration that stamped them.
 *
 * Expected behaviour: the build writes a record of the inputs it was made from
 * and of what the APK packages, read back out of the APK itself, and the
 * installer installs only an APK whose packaged outputs match that record and
 * whose inputs match the tree, the identity, the Rust selection and the
 * handset asked for.
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  APK,
  RELEASE_APK,
  build,
  checkout,
  compiledManifest,
  elf,
  sha256,
  write,
} from '../__shared__/apkFixture';
import { runGit } from '../__shared__/gitFixture';

const record = require('../../../scripts/lib/build-record.js');
const { sourceIdentity, buildStamp } = require('../../../scripts/lib/build-stamp.js');

const EXPECT = { applicationId: 'com.veloq.app.dev', profile: 'release', features: [] };

function verify(root: string, expect: Record<string, unknown> = {}) {
  return record.verifyRecord(root, path.join(root, APK), { ...EXPECT, ...expect });
}

describe('the build record', () => {
  let root: string;
  beforeEach(() => {
    root = checkout();
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('verifies a build against the tree it was made from', () => {
    const apk = build(root);
    const written = record.writeRecord(root, apk, { variant: 'debug' });

    expect(written.application.id).toBe('com.veloq.app.dev');
    expect(written.rust).toMatchObject({
      profile: 'release',
      features: [],
      targets: ['arm64-v8a'],
    });
    expect(verify(root).problems).toEqual([]);
  });

  it('verifies a build off a dirty tree while the tree is unchanged', () => {
    write(root, 'src/app.ts', 'export const greeting = "edited";\n');
    record.writeRecord(root, build(root), { variant: 'debug' });

    expect(verify(root).problems).toEqual([]);
  });

  it('refuses after a dirty source changes again, though the commit and dirty flag are the same', () => {
    write(root, 'src/app.ts', 'export const greeting = "edited";\n');
    record.writeRecord(root, build(root), { variant: 'debug' });
    write(root, 'src/app.ts', 'export const greeting = "edited twice";\n');

    expect(verify(root).problems.join('\n')).toMatch(/inputs/);
  });

  it('refuses after an untracked source appears', () => {
    record.writeRecord(root, build(root), { variant: 'debug' });
    write(root, 'src/added.ts', 'export const added = 1;\n');

    expect(verify(root).problems.join('\n')).toMatch(/inputs/);
  });

  it('refuses after a submodule source is edited', () => {
    record.writeRecord(root, build(root), { variant: 'debug' });
    write(root, 'modules/veloqrs/rust/matcher/src/lib.rs', 'pub fn matches() -> bool { false }\n');

    expect(verify(root).problems.join('\n')).toMatch(/inputs/);
  });

  it('refuses to record an APK that packages a bundle other than the one built', () => {
    const apk = build(root, { packagedBundle: 'var app = "an older bundle";' });

    expect(() => record.writeRecord(root, apk, { variant: 'debug' })).toThrow(/bundle/);
  });

  it('refuses an APK whose bundle was swapped after the record was written', () => {
    record.writeRecord(root, build(root), { variant: 'debug' });
    const recorded = fs.readFileSync(record.recordPath(path.join(root, APK)));
    build(root, { packagedBundle: 'var app = "an older bundle";' });
    fs.writeFileSync(record.recordPath(path.join(root, APK)), recorded);

    expect(verify(root).problems.join('\n')).toMatch(/bundle/);
  });

  it('refuses to record an APK that packages a Rust library other than the one built', () => {
    const apk = build(root, { packagedRust: 'an older engine' });

    expect(() => record.writeRecord(root, apk, { variant: 'debug' })).toThrow(/Rust/);
  });

  it('refuses to record a Rust library built from other Rust sources', () => {
    const apk = build(root);
    const manifest = path.join(
      root,
      'modules/veloqrs/build/rust/android/release-arm64-v8a/manifest.json'
    );
    const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    fs.writeFileSync(manifest, JSON.stringify({ ...parsed, sources: '0'.repeat(64) }));

    expect(() => record.writeRecord(root, apk, { variant: 'debug' })).toThrow(/Rust sources/);
  });

  it('refuses to record when the inputs changed after the bundle was built', () => {
    const apk = build(root);
    write(root, 'modules/veloqrs/rust/veloqrs/src/lib.rs', 'pub fn init() { }\n');

    expect(() => record.writeRecord(root, apk, { variant: 'debug' })).toThrow(/changed/);
  });

  it('refuses a build with other features or another profile than asked for', () => {
    record.writeRecord(root, build(root, { features: ['synthetic'] }), { variant: 'debug' });

    expect(verify(root).problems.join('\n')).toMatch(/features/);
    expect(verify(root, { features: ['synthetic'] }).problems).toEqual([]);
    expect(verify(root, { features: ['synthetic'], profile: 'debug' }).problems.join('\n')).toMatch(
      /profile/
    );
  });

  it('refuses a build that carries no library for the handset', () => {
    record.writeRecord(root, build(root, { abis: ['x86_64'] }), { variant: 'debug' });

    expect(verify(root, { deviceAbis: ['arm64-v8a', 'armeabi-v7a'] }).problems.join('\n')).toMatch(
      /arm64-v8a/
    );
    expect(verify(root, { deviceAbis: ['x86_64'] }).problems).toEqual([]);
  });

  it('refuses another app identity', () => {
    record.writeRecord(root, build(root, { applicationId: 'com.veloq.app' }), { variant: 'debug' });

    expect(verify(root).problems.join('\n')).toMatch(/com\.veloq\.app\b/);
    expect(verify(root, { applicationId: 'com.veloq.app' }).problems).toEqual([]);
  });

  it('refuses an APK with no record', () => {
    build(root);

    expect(verify(root).problems.join('\n')).toMatch(/no build record/);
  });

  it('keeps the commit that produced a build when the tree moves on with the same inputs', () => {
    const written = record.writeRecord(root, build(root), { variant: 'debug' });
    write(root, 'docs/notes.md', 'notes\n');
    runGit(['add', 'docs/notes.md'], root);
    runGit(['commit', '-qm', 'notes'], root);

    const result = verify(root);
    expect(result.problems).toEqual([]);
    expect(result.record.source.commit).toBe(written.source.commit);
    expect(result.summary).toContain(written.source.commit);
  });
});

describe('the build record of a release APK', () => {
  let root: string;
  beforeEach(() => {
    root = checkout();
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const apk = () => path.join(root, RELEASE_APK);
  const verifyRelease = () => record.verifyRecord(root, apk(), EXPECT);

  it('verifies a Gradle-bundled build when the inputs held throughout', () => {
    const snapshot = sourceIdentity(root);
    build(root, { gradleBundle: true });
    const written = record.writeRecord(root, apk(), { variant: 'release', snapshot });

    expect(written.variant).toBe('release');
    expect(written.javascript.inputs).toBe(snapshot.inputs);
    expect(verifyRelease().problems).toEqual([]);
  });

  it('refuses to record a Gradle-bundled build without a snapshot of its inputs', () => {
    build(root, { gradleBundle: true });

    expect(() => record.writeRecord(root, apk(), { variant: 'release' })).toThrow(/bundle/);
  });

  it('refuses to record when the inputs changed while Gradle ran', () => {
    const snapshot = sourceIdentity(root);
    build(root, { gradleBundle: true });
    write(root, 'src/app.ts', 'export const greeting = "edited mid-build";\n');

    expect(() => record.writeRecord(root, apk(), { variant: 'release', snapshot })).toThrow(
      /changed/
    );
  });

  it('refuses a recorded build after an input edit', () => {
    const snapshot = sourceIdentity(root);
    build(root, { gradleBundle: true });
    record.writeRecord(root, apk(), { variant: 'release', snapshot });
    write(root, 'src/app.ts', 'export const greeting = "edited after";\n');

    expect(verifyRelease().problems.join('\n')).toMatch(/inputs/);
  });

  it('refuses a release APK whose bundle was swapped after the record was written', () => {
    const snapshot = sourceIdentity(root);
    build(root, { gradleBundle: true });
    record.writeRecord(root, apk(), { variant: 'release', snapshot });
    const recorded = fs.readFileSync(record.recordPath(apk()));
    build(root, { gradleBundle: true, packagedBundle: 'var app = "an older bundle";' });
    fs.writeFileSync(record.recordPath(apk()), recorded);

    expect(verifyRelease().problems.join('\n')).toMatch(/bundle/);
  });
});

describe('the embedded bundle record', () => {
  let root: string;
  beforeEach(() => {
    root = checkout();
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('refuses a bundle whose inputs changed while it was being built, and records nothing', () => {
    const before = sourceIdentity(root);
    write(root, record.BUNDLE, 'var app = "hello";');
    write(root, 'src/app.ts', 'export const greeting = "mid-build";\n');

    expect(() => record.recordBundle(root, before)).toThrow(/changed/);
    expect(fs.existsSync(path.join(root, record.BUNDLE_RECORD))).toBe(false);
  });
});

describe('the build stamp', () => {
  it('tells two different dirty trees apart', () => {
    const root = checkout();
    write(root, 'src/app.ts', 'export const greeting = "one";\n');
    const first = buildStamp(root);
    write(root, 'src/app.ts', 'export const greeting = "two";\n');
    const second = buildStamp(root);

    expect(first).toMatch(/^[0-9a-f]+\+[0-9a-f]{8}$/);
    expect(second).not.toBe(first);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('reading an APK', () => {
  it('names the package a compiled manifest declares', () => {
    expect(record.manifestPackage(compiledManifest('com.veloq.app.dev'))).toBe('com.veloq.app.dev');
  });

  it('identifies a library by the image the loader maps, which a strip leaves alone', () => {
    const built = elf('arm64-v8a', 'engine');
    const stripped = elf('arm64-v8a', 'engine', true);

    expect(sha256(built)).not.toBe(sha256(stripped));
    expect(record.loadImageHash(stripped)).toBe(record.loadImageHash(built));
    expect(record.loadImageHash(elf('arm64-v8a', 'engin2'))).not.toBe(record.loadImageHash(built));
  });
});
