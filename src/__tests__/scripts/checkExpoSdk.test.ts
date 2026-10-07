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
};

function runGuard({ bundled, declared, locked }: Fixture) {
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
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: declared }));
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

  it('accepts the specified screens repair and rejects a further screens bump', () => {
    const base = {
      bundled: { 'react-native-screens': '4.25.2' },
      declared: { 'react-native-screens': '4.28.0' },
      locked: { 'react-native-screens': '4.28.0' },
    };
    expect(runGuard(base).status).toBe(0);
    expect(runGuard({ ...base, locked: { 'react-native-screens': '4.29.0' } }).status).toBe(1);
  });
});
