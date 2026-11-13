/**
 * Expected behaviour: the guard fails a dependency named for a store integrity
 * or licensing check, and a call to one of those checks or to an install-source
 * lookup, in the app, the proxy and the native modules, naming each by file.
 * Test code is left alone.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/check-no-install-gate.mjs');

function runGuard(root?: string): { status: number; output: string } {
  const args = root ? [SCRIPT, '--root', root] : [SCRIPT];
  const result = spawnSync('node', args, { encoding: 'utf8' });
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'no-install-gate-'));
  roots.push(root);
  const manifest = { name: 'kiln-fixture', version: '1.0.0', dependencies: {} };
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('fails a dependency named for a store integrity check', () => {
  const root = fixture({});
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'kiln-fixture',
      version: '1.0.0',
      dependencies: { 'react-native-play-integrity': '1.0.0' },
    })
  );

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('package.json');
  expect(output).toContain('react-native-play-integrity');
});

it('fails an install-source lookup in a native module', () => {
  const root = fixture({
    'modules/installs/android/src/main/java/app/Installer.kt': [
      'fun source(context: Context): String? =',
      '    context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('modules/installs/android/src/main/java/app/Installer.kt');
  expect(output).toContain('getInstallSourceInfo');
});

it('fails a verdict request in the OAuth proxy', () => {
  const root = fixture({
    'oauth-proxy/src/verdict.ts':
      "export const url = 'https://playintegrity.googleapis.com/v1/projects/x:decodeIntegrityToken';",
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('oauth-proxy/src/verdict.ts');
  expect(output).toContain('playintegrity.googleapis.com');
});

it('fails a licensing identifier in the app config', () => {
  const root = fixture({
    'app.config.js': "module.exports = { plugins: ['com.google.android.vending.licensing'] };",
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('app.config.js');
});

it('passes a tree with no install gate', () => {
  const root = fixture({
    'src/app/index.ts': "export const storeUrl = 'https://play.google.com/store/apps';",
    'modules/installs/android/src/main/java/app/Share.kt': 'fun share() = Unit',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(0);
  expect(output).toContain('nothing is gated on where the app was installed');
});

it('leaves test code that names an identifier alone', () => {
  const root = fixture({
    'src/__tests__/scripts/fixture.test.ts':
      "const fake = 'getInstallSourceInfo';\nconst other = 'DCAppAttestService';",
    'src/app/gate.test.ts': "const fake = 'getInstallerPackageName';",
  });

  const { status } = runGuard(root);

  expect(status).toBe(0);
});
