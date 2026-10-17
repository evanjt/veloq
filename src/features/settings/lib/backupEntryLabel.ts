/**
 * What a backup entry says about itself before a restore replaces the library
 * with it: when it was made, to the minute, its size, the version that wrote
 * it, and its activity count when the entry records one. Two backups made on
 * one day read apart.
 */

import type { TFunction } from 'i18next';

import { formatDateTime, formatFileSize } from '@/shared/format/format';

import type { BackupEntry } from './autobackup/backends';

export interface BackupEntryParts {
  /** The date and time the backup was made. */
  when: string;
  /** Size, version and activity count, the parts the entry knows, joined. */
  details: string;
}

export function backupEntryParts(entry: BackupEntry, t: TFunction): BackupEntryParts {
  const details: string[] = [];
  if (entry.sizeBytes > 0) details.push(formatFileSize(entry.sizeBytes));
  if (entry.appVersion) details.push(t('backup.entryAppVersion', { version: entry.appVersion }));
  if (entry.activityCount != null) {
    details.push(t('backup.entryActivities', { count: entry.activityCount }));
  }
  return { when: formatDateTime(entry.timestamp), details: details.join(' · ') };
}

export function backupEntryLabel(entry: BackupEntry, t: TFunction): string {
  const { when, details } = backupEntryParts(entry, t);
  return details ? `${when} · ${details}` : when;
}
