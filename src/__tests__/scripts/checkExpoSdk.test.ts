/**
 * Scenario: SDK packages and React Native tooling can drift within a major.
 * Expected behaviour: the guard rejects unsafe declared and locked versions.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPTS = resolve(__dirname, '../../../scripts');
const SCRIPT = join(SCRIPTS, 'check-expo-sdk.mjs');

type Fixture = {
  bundled: Record<string, string>;
  declared: Record<string, string>;
  locked: Record<string, string>;
  excluded?: string[];
};

function runGuard({ bundled, declared, locked, excluded }: Fixture) {
  const root = mkdtempSync(join(tmpdir(), 'check-expo-sdk-'));
  try {
    mkdirSync(join(root, 'scripts/lib'), { recursive: true });
    mkdirSync(join(root, 'node_modules/expo'), { recursive: true });
    copyFileSync(SCRIPT, join(root, 'scripts/check-expo-sdk.mjs'));
    copyFileSync(
      join(SCRIPTS, 'lib/indexedSources.mjs'),
      join(root, 'scripts/lib/indexedSources.mjs')
    );
    writeFileSync(
      join(root, 'node_modules/expo/bundledNativeModules.json'),
      JSON.stringify(bundled)
    );
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: declared,
        ...(excluded ? { expo: { install: { exclude: excluded } } } : {}),
      })
    );
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({
        packages: Object.fromEntries(
          Object.entries(locked).map(([name, version]) => [`node_modules/${name}`, { version }])
        ),
      })
    );
    const result = spawnSync('node', [join(root, 'scripts/check-expo-sdk.mjs')], {
      encoding: 'utf8',
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('Expo SDK dependency guard', () => {
  it('rejects a React Native minor change inside major zero', () => {
    const result = runGuard({
      bundled: { 'react-native': '0.85.3' },
      declared: { 'react-native': '0.86.0' },
      locked: { 'react-native': '0.86.0' },
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('react-native');
  });

  it('rejects a major change to an SDK tilde range', () => {
    const result = runGuard({
      bundled: { 'expo-example': '~56.0.10' },
      declared: { 'expo-example': '^57.0.8' },
      locked: { 'expo-example': '57.0.8' },
    });
    expect(result.status).toBe(1);
  });

  it('rejects minor drift from an SDK tilde range in either package file', () => {
    const base = {
      bundled: { 'expo-example': '~56.0.10' },
      declared: { 'expo-example': '~56.0.15' },
      locked: { 'expo-example': '56.0.15' },
    };
    expect(runGuard(base).status).toBe(0);
    expect(runGuard({ ...base, declared: { 'expo-example': '~56.1.0' } }).status).toBe(1);
    expect(runGuard({ ...base, locked: { 'expo-example': '56.1.0' } }).status).toBe(1);
  });

  it('rejects a change to an exact React pin', () => {
    const result = runGuard({
      bundled: { react: '19.2.3' },
      declared: { react: '19.3.0' },
      locked: { react: '19.3.0' },
    });
    expect(result.status).toBe(1);
  });

  it('rejects a range around an exact SDK pin', () => {
    const result = runGuard({
      bundled: { react: '19.2.3' },
      declared: { react: '^19.2.3' },
      locked: { react: '19.2.3' },
    });
    expect(result.status).toBe(1);
  });

  it('rejects a lockfile change when the declaration still matches', () => {
    const result = runGuard({
      bundled: { 'react-native': '0.85.3' },
      declared: { 'react-native': '0.85.3' },
      locked: { 'react-native': '0.86.0' },
    });
    expect(result.status).toBe(1);
  });

  it('holds React Native tooling to the React Native major and minor', () => {
    const result = runGuard({
      bundled: { 'react-native': '0.85.3' },
      declared: { 'react-native': '0.85.3', '@react-native/jest-preset': '^0.87.1' },
      locked: { 'react-native': '0.85.3', '@react-native/jest-preset': '0.87.1' },
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('@react-native/jest-preset');
  });

  it('requires the screens repair in both package files', () => {
    const base = {
      bundled: { 'react-native-screens': '4.25.2' },
      declared: { 'react-native-screens': '4.28.0' },
      locked: { 'react-native-screens': '4.28.0' },
    };
    expect(runGuard(base).status).toBe(0);
    expect(runGuard({ ...base, declared: { 'react-native-screens': '4.25.2' } }).status).toBe(1);
    expect(runGuard({ ...base, locked: { 'react-native-screens': '4.25.2' } }).status).toBe(1);
    expect(runGuard({ ...base, locked: { 'react-native-screens': '4.29.0' } }).status).toBe(1);
  });

  it('requires the null EGL surface repair to Skia in both package files', () => {
    const base = {
      bundled: { '@shopify/react-native-skia': '2.6.2' },
      declared: { '@shopify/react-native-skia': '2.9.1' },
      locked: { '@shopify/react-native-skia': '2.9.1' },
    };
    expect(runGuard(base).status).toBe(0);
    for (const version of ['2.6.2', '2.6.3', '2.9.0', '2.10.0', '^2.9.1', '~2.9.1']) {
      const declared = runGuard({ ...base, declared: { '@shopify/react-native-skia': version } });
      expect(declared.status).toBe(1);
      expect(declared.output).toContain('@shopify/react-native-skia');
    }
    for (const version of ['2.6.2', '2.6.3', '2.10.0']) {
      expect(runGuard({ ...base, locked: { '@shopify/react-native-skia': version } }).status).toBe(
        1
      );
    }
  });

  it('requires the reanimated repair in both package files', () => {
    const base = {
      bundled: { 'react-native-reanimated': '4.3.1' },
      declared: { 'react-native-reanimated': '4.3.4' },
      locked: { 'react-native-reanimated': '4.3.4' },
    };
    expect(runGuard(base).status).toBe(0);
    expect(runGuard({ ...base, declared: { 'react-native-reanimated': '4.3.0' } }).status).toBe(1);
    expect(runGuard({ ...base, declared: { 'react-native-reanimated': '4.4.0' } }).status).toBe(1);
    expect(runGuard({ ...base, locked: { 'react-native-reanimated': '4.3.1' } }).status).toBe(1);
    expect(runGuard({ ...base, locked: { 'react-native-reanimated': '4.4.0' } }).status).toBe(1);
  });

  it('holds screens to its floor whatever the SDK bundles', () => {
    const bundled = { 'react-native-screens': '~4.26.0' };
    const below = runGuard({
      bundled,
      declared: { 'react-native-screens': '~4.26.0' },
      locked: { 'react-native-screens': '4.26.0' },
    });
    expect(below.status).toBe(1);
    expect(below.output).toContain('react-native-screens');
    expect(below.output).toContain('4.28.0');

    const repaired = {
      bundled,
      declared: { 'react-native-screens': '4.28.0' },
      locked: { 'react-native-screens': '4.28.0' },
    };
    expect(runGuard(repaired).status).toBe(0);
    expect(runGuard({ ...repaired, declared: { 'react-native-screens': '^4.28.0' } }).status).toBe(
      1
    );
    expect(runGuard({ ...repaired, locked: { 'react-native-screens': '4.29.0' } }).status).toBe(1);
    expect(
      runGuard({
        bundled,
        declared: { 'react-native-screens': '5.0.0' },
        locked: { 'react-native-screens': '5.0.0' },
      }).status
    ).toBe(1);
  });

  it('follows the SDK again once its screens reach the floor', () => {
    const base = {
      bundled: { 'react-native-screens': '~4.29.0' },
      declared: { 'react-native-screens': '~4.29.0' },
      locked: { 'react-native-screens': '4.29.1' },
    };
    expect(runGuard(base).status).toBe(0);
    expect(
      runGuard({
        ...base,
        declared: { 'react-native-screens': '4.28.0' },
        locked: { 'react-native-screens': '4.28.0' },
      }).status
    ).toBe(1);
  });

  it('refuses a background task manager that keeps every task callback', () => {
    const result = runGuard({
      bundled: { 'expo-task-manager': '~56.0.10' },
      declared: { 'expo-task-manager': '~56.0.16' },
      locked: { 'expo-task-manager': '56.0.16' },
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('expo-task-manager');
    expect(result.output).toContain('56.0.24');

    const current = {
      bundled: { 'expo-task-manager': '~56.0.27' },
      declared: { 'expo-task-manager': '~56.0.27' },
      locked: { 'expo-task-manager': '56.0.27' },
    };
    expect(runGuard(current).status).toBe(0);

    const pinned = {
      bundled: { 'expo-task-manager': '~56.0.10' },
      declared: { 'expo-task-manager': '56.0.24' },
      locked: { 'expo-task-manager': '56.0.24' },
    };
    expect(runGuard(pinned).status).toBe(0);
    expect(runGuard({ ...pinned, locked: { 'expo-task-manager': '56.0.16' } }).status).toBe(1);
  });

  it('refuses a location module that leaks its watches', () => {
    const base = {
      bundled: { 'expo-location': '~56.0.26' },
      declared: { 'expo-location': '~56.0.26' },
      locked: { 'expo-location': '56.0.26' },
    };
    expect(runGuard(base).status).toBe(0);
    const result = runGuard({
      bundled: { 'expo-location': '~56.0.10' },
      declared: { 'expo-location': '~56.0.15' },
      locked: { 'expo-location': '56.0.15' },
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('expo-location');
    expect(result.output).toContain('56.0.24');
  });

  it('refuses a later release line that predates the repair on that line', () => {
    const bundled = { 'react-native-reanimated': '4.5.1' };
    const result = runGuard({
      bundled,
      declared: { 'react-native-reanimated': '4.5.1' },
      locked: { 'react-native-reanimated': '4.5.1' },
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('react-native-reanimated');
    expect(result.output).toContain('4.5.4');

    const repaired = {
      bundled,
      declared: { 'react-native-reanimated': '4.5.4' },
      locked: { 'react-native-reanimated': '4.5.4' },
    };
    expect(runGuard(repaired).status).toBe(0);
    expect(runGuard({ ...repaired, locked: { 'react-native-reanimated': '4.5.3' } }).status).toBe(
      1
    );
    expect(
      runGuard({
        bundled,
        declared: { 'react-native-reanimated': '4.3.4' },
        locked: { 'react-native-reanimated': '4.3.4' },
      }).status
    ).toBe(1);
    expect(
      runGuard({
        bundled: { 'react-native-reanimated': '4.4.3' },
        declared: { 'react-native-reanimated': '4.4.3' },
        locked: { 'react-native-reanimated': '4.4.3' },
      }).status
    ).toBe(1);
    expect(
      runGuard({
        bundled: { 'react-native-reanimated': '4.6.0' },
        declared: { 'react-native-reanimated': '4.6.0' },
        locked: { 'react-native-reanimated': '4.6.0' },
      }).status
    ).toBe(0);
  });

  it('holds the background and location repairs on the SDK 57 release line', () => {
    const early = runGuard({
      bundled: { 'expo-task-manager': '~57.0.3', 'expo-location': '~57.0.3' },
      declared: { 'expo-task-manager': '~57.0.3', 'expo-location': '~57.0.3' },
      locked: { 'expo-task-manager': '57.0.3', 'expo-location': '57.0.3' },
    });
    expect(early.status).toBe(1);
    expect(early.output).toContain('57.0.7');
    expect(early.output).toContain('57.0.10');

    expect(
      runGuard({
        bundled: { 'expo-task-manager': '~57.0.21', 'expo-location': '~57.0.21' },
        declared: { 'expo-task-manager': '~57.0.21', 'expo-location': '~57.0.21' },
        locked: { 'expo-task-manager': '57.0.21', 'expo-location': '57.0.21' },
      }).status
    ).toBe(0);
  });

  it('refuses a worklets runtime that keeps scheduling frames while Android caches the app', () => {
    const early = runGuard({
      bundled: { 'react-native-worklets': '0.10.1' },
      declared: { 'react-native-worklets': '0.10.1' },
      locked: { 'react-native-worklets': '0.10.1' },
    });
    expect(early.status).toBe(1);
    expect(early.output).toContain('react-native-worklets');
    expect(early.output).toContain('0.13.0');

    const fixed = {
      bundled: { 'react-native-worklets': '0.13.0' },
      declared: { 'react-native-worklets': '0.13.0' },
      locked: { 'react-native-worklets': '0.13.0' },
    };
    expect(runGuard(fixed).status).toBe(0);
    expect(runGuard({ ...fixed, locked: { 'react-native-worklets': '0.12.2' } }).status).toBe(1);
    expect(
      runGuard({
        bundled: { 'react-native-worklets': '0.14.0' },
        declared: { 'react-native-worklets': '0.14.0' },
        locked: { 'react-native-worklets': '0.14.0' },
      }).status
    ).toBe(0);
  });

  it('lets Expo skip only a package the guard holds above the SDK', () => {
    const fixture = {
      bundled: { 'react-native-screens': '~4.26.0', 'expo-example': '~57.0.2' },
      declared: { 'react-native-screens': '4.28.0', 'expo-example': '~57.0.2' },
      locked: { 'react-native-screens': '4.28.0', 'expo-example': '57.0.2' },
    };
    expect(runGuard({ ...fixture, excluded: ['react-native-screens'] }).status).toBe(0);

    const stray = runGuard({ ...fixture, excluded: ['react-native-screens', 'expo-example'] });
    expect(stray.status).toBe(1);
    expect(stray.output).toContain('expo-example');

    const released = runGuard({
      ...fixture,
      bundled: { ...fixture.bundled, 'react-native-screens': '~4.28.0' },
      excluded: ['react-native-screens'],
    });
    expect(released.status).toBe(1);
    expect(released.output).toContain('react-native-screens');
  });
});
