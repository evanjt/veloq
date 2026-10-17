/**
 * Scenario: a pull request changes some paths and perhaps the lockfile, and CI
 * has to know which of its areas the change can reach.
 * Expected behaviour: one classifier names the areas, and a lockfile bump
 * reaches native code only when a changed package ships native code.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const SCRIPT = resolve(__dirname, '../../../scripts/ci-areas.mjs');

type Lock = { packages: Record<string, Record<string, unknown>> };
type Areas = Record<'appJs' | 'native' | 'rust' | 'oauthProxy' | 'fastlane' | 'workflows', boolean>;

const NONE: Areas = {
  appJs: false,
  native: false,
  rust: false,
  oauthProxy: false,
  fastlane: false,
  workflows: false,
};

function lock(entries: Record<string, string>): Lock {
  return {
    packages: {
      '': { name: 'fixture-app' },
      ...Object.fromEntries(Object.entries(entries).map(([key, version]) => [key, { version }])),
    },
  };
}

const BASE = lock({
  'node_modules/zod': '4.6.4',
  'node_modules/react-native-ble-plx': '3.5.0',
  'node_modules/lantern-kit': '1.0.0',
  'node_modules/lantern-kit/node_modules/wick-native': '2.0.0',
});

let root: string;

function install(name: string, marker?: string) {
  const dir = join(root, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }));
  if (marker === 'android' || marker === 'ios') mkdirSync(join(dir, marker));
  else if (marker) writeFileSync(join(dir, marker), '{}');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ci-areas-'));
  install('zod');
  install('react-native-ble-plx', 'android');
  install('lantern-kit');
  install('lantern-kit/node_modules/wick-native', 'expo-module.config.json');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function classify(paths: string[], head: Lock = BASE, base: Lock = BASE): Areas {
  const driver = `
    import { ciAreas } from ${JSON.stringify(SCRIPT)};
    const input = JSON.parse(process.argv[1]);
    process.stdout.write(JSON.stringify(ciAreas(input)));
  `;
  const out = execFileSync(
    'node',
    ['--input-type=module', '-e', driver, JSON.stringify({ paths, base, head, root })],
    { encoding: 'utf8', env: gitFreeEnv() }
  );
  return JSON.parse(out);
}

function bump(key: string, version: string): Lock {
  return { packages: { ...BASE.packages, [key]: { version } } };
}

describe('ciAreas', () => {
  it('reads a pure JavaScript package bump as app code and not native', () => {
    const head = bump('node_modules/zod', '4.6.5');
    expect(classify(['package.json', 'package-lock.json'], head)).toEqual({
      ...NONE,
      appJs: true,
    });
  });

  it('reads a bump of a package with an android directory as native', () => {
    const head = bump('node_modules/react-native-ble-plx', '3.5.1');
    expect(classify(['package.json', 'package-lock.json'], head)).toEqual({
      ...NONE,
      appJs: true,
      native: true,
    });
  });

  it('reads a nested native package by its own install path', () => {
    const head = bump('node_modules/lantern-kit/node_modules/wick-native', '2.1.0');
    expect(classify(['package-lock.json'], head)).toEqual({ ...NONE, appJs: true, native: true });
  });

  it('reads an added native package and a removed one as native', () => {
    install('glow-ios', 'ios');
    const added = { packages: { ...BASE.packages, 'node_modules/glow-ios': { version: '1.0.0' } } };
    expect(classify(['package-lock.json'], added).native).toBe(true);
    expect(classify(['package-lock.json'], BASE, added).native).toBe(true);
  });

  it('reads a package with a react-native config as native', () => {
    install('ember-bridge', 'react-native.config.js');
    const base = {
      packages: { ...BASE.packages, 'node_modules/ember-bridge': { version: '1.0.0' } },
    };
    const head = {
      packages: { ...BASE.packages, 'node_modules/ember-bridge': { version: '1.0.1' } },
    };
    expect(classify(['package-lock.json'], head, base).native).toBe(true);
  });

  it('counts a changed package it cannot find installed as native', () => {
    const head = { packages: { ...BASE.packages, 'node_modules/unseen': { version: '1.0.0' } } };
    expect(classify(['package-lock.json'], head).native).toBe(true);
  });

  it('does not count a platform binary for another machine as native', () => {
    const head = {
      packages: {
        ...BASE.packages,
        'node_modules/@kiln/other-os': { version: '1.0.0', optional: true, os: ['darwin'] },
      },
    };
    expect(classify(['package-lock.json'], head)).toEqual({ ...NONE, appJs: true });
  });

  it('reads a lockfile rewrite that changes no package as nothing native', () => {
    expect(classify(['package-lock.json'])).toEqual({ ...NONE, appJs: true });
  });

  it('reads paths under oauth-proxy alone as only the proxy', () => {
    expect(classify(['oauth-proxy/src/index.ts', 'oauth-proxy/package-lock.json'])).toEqual({
      ...NONE,
      oauthProxy: true,
    });
  });

  it('reads paths under the engine crate alone as only rust', () => {
    expect(
      classify(['modules/veloqrs/rust/veloqrs/src/lib.rs', 'modules/veloqrs/rust/Cargo.lock'])
    ).toEqual({ ...NONE, rust: true });
  });

  it('reads the Build workflow as workflows and native', () => {
    expect(classify(['.github/workflows/build.yml'])).toEqual({
      ...NONE,
      workflows: true,
      native: true,
    });
  });

  it.each(['.github/workflows/build-android.yml', '.github/ci-init.gradle'])(
    'reads %s, which the Android build runs, as workflows and native',
    (path) => {
      expect(classify([path])).toEqual({ ...NONE, workflows: true, native: true });
    }
  );

  it('reads another workflow as workflows alone', () => {
    expect(classify(['.github/workflows/deploy-website.yml'])).toEqual({
      ...NONE,
      workflows: true,
    });
  });

  it('reads the fastlane configuration as fastlane alone', () => {
    expect(classify(['config/fastlane/Fastfile'])).toEqual({ ...NONE, fastlane: true });
  });

  it.each([
    'widget/ios/Widget.swift',
    'push/android/Receiver.kt',
    'ios/Podfile',
    'src/plugins/withLantern.js',
  ])('reads %s as native', (path) => {
    expect(classify([path])).toEqual({ ...NONE, native: true });
  });

  it.each([
    'app.json',
    'app.config.js',
    'modules/veloq-focus/index.ts',
    'expo-modules/lantern/ios/Module.swift',
    'react-native.config.js',
    'scripts/lib/app-identity.js',
    'scripts/lib/build-stamp.js',
    'src/theme/appColours.json',
  ])('reads %s as native and app code', (path) => {
    expect(classify([path])).toEqual({ ...NONE, native: true, appJs: true });
  });

  it('reads app source as app code alone', () => {
    expect(classify(['src/features/lantern/Glow.tsx'])).toEqual({ ...NONE, appJs: true });
  });

  it('reads documentation alone as no area', () => {
    expect(classify(['README.md', 'docs/lantern.md'])).toEqual(NONE);
  });

  it('reads no change as no area', () => {
    expect(classify([])).toEqual(NONE);
  });
});

describe('ci-areas command', () => {
  const git = (...args: string[]) => runGit(args, root);

  it('writes each area to the step outputs for the change since a base', () => {
    git('init', '-q', '-b', 'trunk');
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify(BASE));
    writeFileSync(join(root, '.gitignore'), 'node_modules\noutputs\n');
    git('add', 'package-lock.json', '.gitignore');
    git('commit', '-q', '-m', 'base');
    const base = git('rev-parse', 'HEAD').trim();
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify(bump('node_modules/react-native-ble-plx', '3.5.1'))
    );
    mkdirSync(join(root, 'oauth-proxy'));
    writeFileSync(join(root, 'oauth-proxy/index.ts'), '');
    git('add', 'package-lock.json', 'oauth-proxy/index.ts');
    git('commit', '-q', '-m', 'head');

    const outputs = join(root, 'outputs');
    writeFileSync(outputs, '');
    const result = spawnSync('node', [SCRIPT, '--base', base, '--root', root], {
      cwd: root,
      encoding: 'utf8',
      env: { ...gitFreeEnv(), GITHUB_OUTPUT: outputs },
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readFileSync(outputs, 'utf8').trim().split('\n').sort()).toEqual(
      [
        'appJs=true',
        'fastlane=false',
        'native=true',
        'oauthProxy=true',
        'rust=false',
        'workflows=false',
      ].sort()
    );
  });

  it('refuses to run without a base', () => {
    const result = spawnSync('node', [SCRIPT, '--root', root], {
      encoding: 'utf8',
      env: gitFreeEnv(),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--base/);
  });
});
