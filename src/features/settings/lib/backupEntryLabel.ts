/**
 * What a backup entry says about itself before a restore replaces the library
 * with it: when it was made, to the minute, its size, and its activity count
 * when the entry records one. Two backups made on one day read apart.
 */

import type { TFunction } from 'i18next';

import { formatDateTime, formatFileSize } from '@/shared/format/format';

import type { BackupEntry } from './autobackup/backends';

export function backupEntryLabel(entry: BackupEntry, t: TFunction): string {
  const parts = [formatDateTime(entry.timestamp)];
  if (entry.sizeBytes > 0) parts.push(formatFileSize(entry.sizeBytes));
  if (entry.activityCount != null) {
    parts.push(t('backup.entryActivities', { count: entry.activityCount }));
  }
  return parts.join(' · ');
}
