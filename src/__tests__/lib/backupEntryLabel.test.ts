/**
 * Scenario: two backups made on one day, one at dawn and one in the evening,
 * listed before a restore that replaces the library.
 *
 * Expected behaviour: each reads with its own date and time, size and the
 * version that wrote it, and an activity count only when the entry records
 * one, so the two are told apart before the choice.
 */

import { backupEntryParts, backupEntryLabel } from '@/features/settings/lib/backupEntryLabel';
import { formatDateTime } from '@/shared/format/format';
import { i18n, initialiseI18n } from '@/i18n';

const dawn = {
  id: 'veloq-2026-03-14T06-30-00-000Z.zip',
  timestamp: '2026-03-14T06:30:00.000Z',
  sizeBytes: 2_400_000,
  appVersion: '0.4.0',
  activityCount: 312,
};
const evening = {
  id: 'veloq-2026-03-14T18-10-00-000Z.zip',
  timestamp: '2026-03-14T18:10:00.000Z',
  sizeBytes: 2_450_000,
  appVersion: '0.4.0',
};

beforeAll(async () => {
  await initialiseI18n();
});

describe('backupEntryLabel', () => {
  it('reads two backups made on one day apart, each with its time and size', () => {
    const first = backupEntryLabel(dawn, i18n.t);
    const second = backupEntryLabel(evening, i18n.t);

    expect(first).not.toBe(second);
    expect(first).toContain(formatDateTime(dawn.timestamp));
    expect(second).toContain(formatDateTime(evening.timestamp));
    expect(formatDateTime(dawn.timestamp)).not.toBe(formatDateTime(evening.timestamp));
    expect(first).toContain('2.4 MB');
    expect(second).toContain('2.5 MB');
  });

  it('names the version that wrote the backup', () => {
    expect(backupEntryLabel(dawn, i18n.t)).toContain('0.4.0');
  });

  it('counts the activities only when the entry records them', () => {
    expect(backupEntryLabel(dawn, i18n.t)).toContain('312');
    expect(backupEntryLabel(evening, i18n.t)).not.toMatch(/activit/i);
  });

  it('leaves out a size and a version the entry does not know', () => {
    const bare = { ...evening, sizeBytes: 0, appVersion: '' };
    expect(backupEntryParts(bare, i18n.t).details).toBe('');
    expect(backupEntryLabel(bare, i18n.t)).toBe(formatDateTime(bare.timestamp));
  });
});
