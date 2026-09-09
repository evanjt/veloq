/**
 * Scenario: an Android 12 or later device backs the app up to the cloud, or
 * transfers it to a new phone.
 *
 * Expected behaviour: the athlete's database travels with it. `fullBackupContent`
 * has applied to Android 11 and lower since Android 12, which reads
 * `dataExtractionRules` instead, so both files have to name the database and
 * both have to keep expo-secure-store's credential exclusion.
 */

import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  BACKUP_RULES,
  DATA_EXTRACTION_RULES,
  configureManifest,
  writeRules,
} = require('../../plugins/with-android-backup');

function mainApplication(): { $: Record<string, string> } {
  return { $: { 'android:allowBackup': 'true' } };
}

describe('with-android-backup rules', () => {
  it('names the database and the local backups in the Android 11 rules', () => {
    expect(BACKUP_RULES).toContain('<full-backup-content>');
    expect(BACKUP_RULES).toContain('domain="file" path="routes.db"');
    expect(BACKUP_RULES).toContain('domain="file" path="backups/"');
    expect(BACKUP_RULES).toContain('<exclude domain="sharedpref" path="SecureStore" />');
  });

  it('names the database in both Android 12 blocks', () => {
    for (const block of ['cloud-backup', 'device-transfer']) {
      const body = DATA_EXTRACTION_RULES.split(`<${block}>`)[1]?.split(`</${block}>`)[0];
      expect(body).toBeDefined();
      expect(body).toContain('domain="file" path="routes.db"');
      expect(body).toContain('domain="file" path="backups/"');
      expect(body).toContain('domain="sharedpref" path="."');
    }
  });

  it('keeps the SecureStore exclusion in both Android 12 blocks', () => {
    const excludes = DATA_EXTRACTION_RULES.match(
      /<exclude domain="sharedpref" path="SecureStore" ?\/>/g
    );
    expect(excludes).toHaveLength(2);
  });

  it('is well-formed data-extraction-rules', () => {
    expect(DATA_EXTRACTION_RULES).toContain('<data-extraction-rules>');
    expect(DATA_EXTRACTION_RULES).toContain('</data-extraction-rules>');
    expect(DATA_EXTRACTION_RULES.startsWith('<?xml')).toBe(true);
  });
});

describe('with-android-backup manifest', () => {
  it('points both attributes at the app rules, not at expo-secure-store', () => {
    const app = mainApplication();
    configureManifest(app);

    expect(app.$['android:fullBackupContent']).toBe('@xml/veloq_backup_rules');
    expect(app.$['android:dataExtractionRules']).toBe('@xml/veloq_data_extraction_rules');
  });

  it('overwrites the expo-secure-store rules a previous prebuild wrote', () => {
    const app = mainApplication();
    app.$['android:dataExtractionRules'] = '@xml/secure_store_data_extraction_rules';

    configureManifest(app);

    expect(app.$['android:dataExtractionRules']).toBe('@xml/veloq_data_extraction_rules');
  });

  it('leaves everything else on the application alone', () => {
    const app = mainApplication();
    configureManifest(app);

    expect(app.$['android:allowBackup']).toBe('true');
  });
});

describe('with-android-backup prebuild output', () => {
  it('writes both rules files into a res/xml that does not exist yet', () => {
    const root = mkdtempSync(join(tmpdir(), 'veloq-backup-'));
    const resDir = join(root, 'app', 'src', 'main', 'res', 'xml');

    writeRules(resDir);

    expect(readdirSync(resDir).sort()).toEqual([
      'veloq_backup_rules.xml',
      'veloq_data_extraction_rules.xml',
    ]);
    expect(readFileSync(join(resDir, 'veloq_data_extraction_rules.xml'), 'utf8')).toContain(
      'routes.db'
    );
  });

  it('overwrites what a previous prebuild left', () => {
    const root = mkdtempSync(join(tmpdir(), 'veloq-backup-'));
    const resDir = join(root, 'res', 'xml');

    writeRules(resDir);
    writeRules(resDir);

    expect(readFileSync(join(resDir, 'veloq_backup_rules.xml'), 'utf8')).toBe(BACKUP_RULES);
  });
});
