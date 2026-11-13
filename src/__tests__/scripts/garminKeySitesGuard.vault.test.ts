/**
 * The Garmin key's keychain item may be named by the connector and the
 * sign-out path alone, so no other file can read the key out or store it
 * outside the keychain options.
 */
import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

const guard = join(__dirname, '../../..', 'scripts', 'check-garmin-key-sites.mjs');

function run(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'garmin-sites-'));
  try {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), text);
    }
    return spawnSync('node', [guard, '--root', dir], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const item = "export const GARMIN_KEY_STORAGE_KEY = 'garmin_personal_key';\n";

describe('the Garmin key sites guard', () => {
  it('passes when only the connector files name the item', () => {
    const result = run({
      'src/shared/app/credentialKeychain.ts': item,
      'src/features/settings/lib/garminConnector.ts': 'GARMIN_KEY_STORAGE_KEY;\n',
    });
    expect(result.status).toBe(0);
  });

  it.each([
    ['the constant', 'GARMIN_KEY_STORAGE_KEY;\n'],
    ['the stored name', "const k = 'garmin_personal_key';\n"],
  ])('refuses another file naming %s', (_label, text) => {
    const result = run({
      'src/shared/app/credentialKeychain.ts': item,
      'src/features/feed/lib/leak.ts': text,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/features/feed/lib/leak.ts');
  });
});
