import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../../..');
const script = join(root, 'scripts/check-module-version.mjs');
const CRATE = 'modules/veloqrs/rust/veloqrs/Cargo.toml';
const CRATE_LOCK = 'modules/veloqrs/rust/Cargo.lock';

function crateManifest(version: string): string {
  return `[package]\nname = "veloqrs"\nversion = "${version}"\nedition = "2024"\n`;
}

function crateLock(version: string): string {
  return [
    'version = 4',
    '',
    '[[package]]',
    'name = "tracematch"',
    'version = "9.9.9"',
    '',
    '[[package]]',
    'name = "veloqrs"',
    `version = "${version}"`,
    '',
  ].join('\n');
}

interface Versions {
  app: string;
  module: string;
  lock: string;
  crate: string;
  crateLock: string;
  expo: string;
  buildNumber: string;
  versionCode: number;
}

/** Run the guard over a checkout whose version copies are `versions`. */
function runOver(versions: Versions) {
  const fixture = mkdtempSync(join(tmpdir(), 'module-version-'));
  try {
    mkdirSync(join(fixture, 'modules/veloqrs/rust/veloqrs'), { recursive: true });
    writeFileSync(join(fixture, 'package.json'), JSON.stringify({ version: versions.app }));
    writeFileSync(
      join(fixture, 'modules/veloqrs/package.json'),
      JSON.stringify({ version: versions.module })
    );
    writeFileSync(
      join(fixture, 'package-lock.json'),
      JSON.stringify({ packages: { 'modules/veloqrs': { version: versions.lock } } })
    );
    writeFileSync(join(fixture, CRATE), crateManifest(versions.crate));
    writeFileSync(join(fixture, CRATE_LOCK), crateLock(versions.crateLock));
    writeFileSync(
      join(fixture, 'app.json'),
      JSON.stringify({
        expo: {
          version: versions.expo,
          ios: { buildNumber: versions.buildNumber },
          android: { versionCode: versions.versionCode },
        },
      })
    );
    return spawnSync('node', [script, fixture], { encoding: 'utf8' });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

const AGREED: Versions = {
  app: '0.4.0',
  module: '0.4.0',
  lock: '0.4.0',
  crate: '0.4.0',
  crateLock: '0.4.0',
  expo: '0.4.0',
  buildNumber: '29',
  versionCode: 29,
};

it('the shipped module version matches the app release', () => {
  const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const module = JSON.parse(readFileSync(join(root, 'modules/veloqrs/package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  expect(module.version).toBe(app.version);
  expect(lock.packages['modules/veloqrs'].version).toBe(app.version);
});

it('the release audit passes a checkout whose every copy names the release', () => {
  const run = runOver(AGREED);
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
});

// The engine stamps its exports with its crate version, so a release bump
// that leaves the crate behind writes the old version into every file.
it('the release audit rejects an engine crate version left behind by a version bump', () => {
  const run = runOver({ ...AGREED, app: '0.4.1', module: '0.4.1', lock: '0.4.1' });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('crate version 0.4.0');
});

it('the release audit rejects a workspace lockfile naming another crate version', () => {
  const run = runOver({ ...AGREED, crateLock: '0.0.10' });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('crate lock version 0.0.10');
});

it('the release audit rejects a checkout whose crate version cannot be read', () => {
  const run = runOver({ ...AGREED, crate: '' });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('crate version');
});

it('the release audit rejects a module version left behind by a version bump', () => {
  const run = runOver({
    ...AGREED,
    app: '0.4.1',
    lock: '0.4.1',
    crate: '0.4.1',
    crateLock: '0.4.1',
  });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('veloqrs version 0.4.0');
});

it('the release audit rejects a stale locked module version', () => {
  const run = runOver({ ...AGREED, lock: '0.1.0' });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('lock version 0.1.0');
});

// The store builds take their version name from app.json, so a bump that
// misses it publishes a release whose binaries name the previous version.
it('the release audit rejects an app.json version left behind by a version bump', () => {
  const run = runOver({
    ...AGREED,
    app: '0.4.1',
    module: '0.4.1',
    lock: '0.4.1',
    crate: '0.4.1',
    crateLock: '0.4.1',
  });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('app.json version 0.4.0');
});

// Both stores refuse a build number they have already seen, so the two
// platforms' build numbers move together.
it('the release audit rejects an iOS build number behind the Android version code', () => {
  const run = runOver({ ...AGREED, versionCode: 30 });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('iOS build number 29');
  expect(run.stderr).toContain('Android version code 30');
});

it('the release audit rejects a checkout whose build numbers cannot be read', () => {
  const run = runOver({ ...AGREED, buildNumber: '' });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('iOS build number');
});
