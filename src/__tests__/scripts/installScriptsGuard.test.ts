/**
 * A dependency with an unreviewed install script must stop the guard before a
 * native build can consume its incomplete package tree. The guard judges the
 * lockfile against `allowScripts`, so it gives the same verdict in a tree with
 * its own install, in a tree whose `node_modules` links each entry into another
 * checkout, and in a tree with no install at all.
 */
import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const root = join(__dirname, '../../..');
const guard = join(root, 'scripts', 'check-install-scripts.mjs');

const registry = 'https://registry.npmjs.org';

interface LockEntry {
  version: string;
  resolved?: string;
  hasInstallScript?: boolean;
  optional?: boolean;
  dev?: boolean;
  os?: string[];
  cpu?: string[];
  inBundle?: boolean;
  link?: boolean;
}

function registryEntry(name: string, version: string, extra: Partial<LockEntry> = {}): LockEntry {
  const base = name.split('/').pop();
  return { version, resolved: `${registry}/${name}/-/${base}-${version}.tgz`, ...extra };
}

function writeProject(
  dir: string,
  packages: Record<string, LockEntry>,
  allowScripts?: Record<string, boolean>
) {
  mkdirSync(dir, { recursive: true });
  const dependencies = Object.fromEntries(
    Object.entries(packages).map(([key, entry]) => [
      key.replace(/^node_modules\//, ''),
      entry.version,
    ])
  );
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'kiln-fixture', version: '1.0.0', dependencies, allowScripts })
  );
  writeFileSync(
    join(dir, 'package-lock.json'),
    JSON.stringify({
      name: 'kiln-fixture',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: 'kiln-fixture', version: '1.0.0', dependencies }, ...packages },
    })
  );
}

/** The guard as the landing gate runs it: through the runner, in the tree it judges. */
function runGuard(cwd: string) {
  const guards = join(cwd, 'guards.json');
  writeFileSync(
    guards,
    JSON.stringify([
      {
        name: 'check:install-scripts',
        kind: 'correctness',
        cmd: [process.execPath, guard],
        catches: 'an unreviewed dependency install script leaves binaries absent',
      },
    ])
  );
  return spawnSync(
    process.execPath,
    [join(root, 'scripts', 'run-guards.mjs'), '--set', 'land', '--guards', guards],
    { cwd, encoding: 'utf8' }
  );
}

let fixture: string;

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'install-scripts-test-'));
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

it('rejects a dependency install script missing from allowScripts', () => {
  writeProject(fixture, {
    'node_modules/glaze-native': registryEntry('glaze-native', '1.0.0', { hasInstallScript: true }),
  });

  const result = runGuard(fixture);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('glaze-native@1.0.0');
});

it('accepts an install script approved by a pinned, a name-only or a denying entry', () => {
  const packages = {
    'node_modules/glaze-native': registryEntry('glaze-native', '1.0.0', { hasInstallScript: true }),
    'node_modules/@kiln/firing': registryEntry('@kiln/firing', '2.3.4', { hasInstallScript: true }),
    'node_modules/clay-gyp': registryEntry('clay-gyp', '0.5.0', { hasInstallScript: true }),
    'node_modules/plain-slip': registryEntry('plain-slip', '3.0.0'),
  };
  writeProject(fixture, packages, {
    'glaze-native@1.0.0': true,
    '@kiln/firing': true,
    'clay-gyp': false,
  });

  const result = runGuard(fixture);

  expect(result.status).toBe(0);
});

it('rejects a pinned approval for another version of the package', () => {
  writeProject(
    fixture,
    {
      'node_modules/glaze-native': registryEntry('glaze-native', '1.1.0', {
        hasInstallScript: true,
      }),
    },
    { 'glaze-native@1.0.0 || 1.0.1': true }
  );

  const result = runGuard(fixture);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('glaze-native@1.1.0');
});

it('judges a nested copy by its own version', () => {
  writeProject(
    fixture,
    {
      'node_modules/glaze-native': registryEntry('glaze-native', '1.0.0', {
        hasInstallScript: true,
      }),
      'node_modules/kiln-shelf/node_modules/glaze-native': registryEntry('glaze-native', '0.9.0', {
        hasInstallScript: true,
      }),
    },
    { 'glaze-native@1.0.0': true }
  );

  const result = runGuard(fixture);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('glaze-native@0.9.0');
  expect(result.stderr).not.toContain('glaze-native@1.0.0');
});

it('skips an optional package that cannot install on this platform, and bundled packages', () => {
  const elsewhere = process.platform === 'win32' ? 'linux' : 'win32';
  writeProject(fixture, {
    'node_modules/kiln-watcher': registryEntry('kiln-watcher', '2.0.0', {
      hasInstallScript: true,
      optional: true,
      os: [elsewhere],
    }),
    'node_modules/kiln-shelf/node_modules/clay-bundled': {
      version: '1.0.0',
      hasInstallScript: true,
      inBundle: true,
    },
  });

  const result = runGuard(fixture);

  expect(result.status).toBe(0);
});

it('rejects an optional package with an install script that does install on this platform', () => {
  writeProject(fixture, {
    'node_modules/kiln-watcher': registryEntry('kiln-watcher', '2.0.0', {
      hasInstallScript: true,
      optional: true,
      os: [process.platform],
    }),
  });

  const result = runGuard(fixture);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('kiln-watcher@2.0.0');
});

it('judges a package the lockfile adds before any install has it', () => {
  writeProject(
    fixture,
    {
      'node_modules/glaze-native': registryEntry('glaze-native', '1.0.0', {
        hasInstallScript: true,
      }),
      'node_modules/clay-gyp': registryEntry('clay-gyp', '0.5.0', { hasInstallScript: true }),
    },
    { 'glaze-native@1.0.0': true }
  );
  mkdirSync(join(fixture, 'node_modules', 'glaze-native'), { recursive: true });

  const result = runGuard(fixture);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('clay-gyp@0.5.0');
});

it('passes in a tree whose node_modules links each entry into another checkout', () => {
  const packages = {
    'node_modules/glaze-native': registryEntry('glaze-native', '1.0.0', { hasInstallScript: true }),
  };
  const allowScripts = { 'glaze-native@1.0.0': true };

  const main = join(fixture, 'main');
  writeProject(main, packages, allowScripts);
  const installed = join(main, 'node_modules', 'glaze-native');
  mkdirSync(installed, { recursive: true });
  writeFileSync(
    join(installed, 'package.json'),
    JSON.stringify({
      name: 'glaze-native',
      version: '1.0.0',
      scripts: { install: 'node install.js' },
      devDependencies: {
        'kiln-preset': 'patch:kiln-preset@npm%3A1.0.0#~/.yarn/patches/kiln-preset.patch',
      },
    })
  );

  const linked = join(fixture, 'linked');
  writeProject(linked, packages, allowScripts);
  mkdirSync(join(linked, 'node_modules'));
  symlinkSync(installed, join(linked, 'node_modules', 'glaze-native'));

  const result = runGuard(linked);

  expect(result.status).toBe(0);
});

it('refuses a tree with no lockfile rather than passing it', () => {
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'kiln-fixture' }));

  const result = runGuard(fixture);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('package-lock.json');
});
