/**
 * Scenario: an athlete reinstalls Veloq, sets up a new phone from their old one, or lets Android
 * back the phone up to their Google account.
 *
 * Expected behaviour: Android carries nothing of the app either way. Its own backup is invisible
 * to the app and restores at install, before the first launch, so whatever it brought back would
 * take effect before the athlete could accept it. `allowBackup="false"` stops the cloud backup,
 * and the device-to-device transfer on Android 12 and later, which ignores that attribute, is
 * stopped by data extraction rules that exclude every domain. No backup agent is named.
 */

import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

const {
  DATA_EXTRACTION_RULES,
  configureManifest,
  writeRules,
} = require('../../plugins/with-android-backup');

const projectRoot = path.join(__dirname, '../../..');

/** Every domain the data extraction rules name, on both storage areas. */
const DOMAINS = [
  'root',
  'file',
  'database',
  'sharedpref',
  'external',
  'device_root',
  'device_file',
  'device_database',
  'device_sharedpref',
];

type Application = { $: Record<string, string> };

/** The application element prebuild generates from the real config, read without writing a manifest. */
async function generatedApplication(): Promise<Application> {
  const expo = require.resolve('expo/package.json', { paths: [projectRoot] });
  const { getPrebuildConfigAsync } = require(
    require.resolve('@expo/prebuild-config', { paths: [expo] })
  );
  const { compileModsAsync } = require('expo/config-plugins');
  const { exp } = await getPrebuildConfigAsync(projectRoot, { platforms: ['android'] });
  const compiled = await compileModsAsync(exp, {
    projectRoot,
    introspect: true,
    platforms: ['android'],
    assertMissingModProviders: false,
  });
  return compiled._internal.modResults.android.manifest.manifest.application[0];
}

function blocks(): string[] {
  return ['cloud-backup', 'device-transfer'].map(
    (block) => DATA_EXTRACTION_RULES.split(`<${block}>`)[1]?.split(`</${block}>`)[0] ?? ''
  );
}

describe('with-android-backup rules', () => {
  it('excludes every domain from the cloud backup and the device transfer', () => {
    for (const body of blocks()) {
      for (const domain of DOMAINS) {
        expect(body).toContain(`<exclude domain="${domain}" path="." />`);
      }
    }
  });

  it('includes nothing in either block', () => {
    for (const body of blocks()) {
      expect(body).not.toBe('');
      expect(body).not.toContain('<include ');
    }
  });

  it('is well-formed data-extraction-rules', () => {
    expect(DATA_EXTRACTION_RULES.startsWith('<?xml')).toBe(true);
    expect(DATA_EXTRACTION_RULES).toContain('<data-extraction-rules>');
    expect(DATA_EXTRACTION_RULES).toContain('</data-extraction-rules>');
  });
});

describe('with-android-backup manifest', () => {
  it('turns backup off and names no agent, whatever a previous prebuild wrote', () => {
    const app: Application = {
      $: {
        'android:allowBackup': 'true',
        'android:backupAgent': 'com.example.LeftoverAgent',
        'android:fullBackupOnly': 'true',
        'android:fullBackupContent': '@xml/secure_store_backup_rules',
        'android:dataExtractionRules': '@xml/secure_store_data_extraction_rules',
      },
    };

    configureManifest(app);

    expect(app.$).toEqual({
      'android:allowBackup': 'false',
      'android:dataExtractionRules': '@xml/veloq_data_extraction_rules',
    });
  });
});

describe('the generated Android manifest', () => {
  let app: Application;
  beforeAll(async () => {
    app = await generatedApplication();
  }, 60_000);

  it('turns Auto Backup off for the app', () => {
    expect(app.$['android:allowBackup']).toBe('false');
  });

  it('names no backup agent, so nothing records or answers a restore', () => {
    expect(app.$['android:backupAgent']).toBeUndefined();
    expect(app.$['android:fullBackupOnly']).toBeUndefined();
  });

  it("points the Android 12 rules at the app's own, not at expo-secure-store's", () => {
    expect(app.$['android:dataExtractionRules']).toBe('@xml/veloq_data_extraction_rules');
  });
});

describe('with-android-backup prebuild output', () => {
  it('writes the rules file into a res/xml that does not exist yet', () => {
    const root = mkdtempSync(join(tmpdir(), 'veloq-backup-'));
    const resDir = join(root, 'app', 'src', 'main', 'res', 'xml');

    writeRules(resDir);

    expect(readdirSync(resDir)).toEqual(['veloq_data_extraction_rules.xml']);
    expect(readFileSync(join(resDir, 'veloq_data_extraction_rules.xml'), 'utf8')).toBe(
      DATA_EXTRACTION_RULES
    );
  });

  it('overwrites what a previous prebuild left', () => {
    const root = mkdtempSync(join(tmpdir(), 'veloq-backup-'));
    const resDir = join(root, 'res', 'xml');

    writeRules(resDir);
    writeRules(resDir);

    expect(readFileSync(join(resDir, 'veloq_data_extraction_rules.xml'), 'utf8')).toBe(
      DATA_EXTRACTION_RULES
    );
  });
});
