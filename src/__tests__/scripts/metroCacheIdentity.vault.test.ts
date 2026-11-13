/**
 * Scenario: two checkouts reach the same `expo-router/_ctx` file through
 * linked `node_modules`. Babel inlines the router app root relative to that
 * file, and Metro keys the cached transform on its path relative to the
 * project root, which is the same string in both. Without a key of its own, a
 * checkout is served the other's app root and bundles no screen.
 *
 * Expected behaviour: the Metro configuration a checkout loads carries a cache
 * identity that differs between checkouts and stays the same across rebuilds
 * of one checkout, however its path is spelled.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const projectRoot = path.join(__dirname, '../../..');

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** A checkout holding the project's Metro configuration and its dependencies. */
function checkout(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-metro-'));
  dirs.push(dir);
  for (const file of ['metro.config.js', 'package.json']) {
    fs.copyFileSync(path.join(projectRoot, file), path.join(dir, file));
  }
  fs.symlinkSync(
    fs.realpathSync(path.join(projectRoot, 'node_modules')),
    path.join(dir, 'node_modules')
  );
  return dir;
}

function cacheVersion(root: string): string {
  return execFileSync(
    process.execPath,
    [
      '-e',
      'process.stdout.write(String(require(process.argv[1]).cacheVersion))',
      path.join(root, 'metro.config.js'),
    ],
    { cwd: root, encoding: 'utf8', env: { ...process.env, EXPO_NO_TELEMETRY: '1' } }
  );
}

describe('the Metro cache identity', () => {
  it('differs between two checkouts sharing one installation', () => {
    expect(cacheVersion(checkout())).not.toBe(cacheVersion(checkout()));
  });

  it('is the same for every rebuild of one checkout', () => {
    const root = checkout();

    expect(cacheVersion(root)).toBe(cacheVersion(root));
  });

  it('is the same through a symlinked path to the checkout', () => {
    const root = checkout();
    const alias = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-metro-alias-')), 'tree');
    dirs.push(path.dirname(alias));
    fs.symlinkSync(root, alias);

    expect(cacheVersion(alias)).toBe(cacheVersion(root));
  });
});
