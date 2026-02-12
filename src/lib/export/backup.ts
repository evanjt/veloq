/**
 * Backup & restore user customizations.
 * Exports/imports custom sections, names, and preferences as a .veloq JSON file.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { shareFile } from './shareFile';

const APP_VERSION = '0.1.2';
const BACKUP_VERSION = 2;

/** AsyncStorage keys that contain user preferences */
const PREFERENCE_KEYS = [
  'veloq-theme-preference',
  'veloq-language-preference',
  'veloq-unit-preference',
  'veloq-primary-sport',
  'veloq-map-preferences',
  'veloq-route-settings',
  'veloq-hr-zones',
  'veloq-debug-mode',
  'veloq-disabled-sections',
  'veloq-section-dismissals',
  'veloq-superseded-sections',
  'veloq-potential-sections',
  'dashboard_preferences',
  'dashboard_summary_card',
] as const;

interface BackupCustomSection {
  name: string;
  sportType: string;
  sourceActivityId: string;
  startIndex: number;
  endIndex: number;
}

interface BackupData {
  version: number;
  exportedAt: string;
  appVersion: string;
  customSections: BackupCustomSection[];
  sectionNames: Record<string, string>;
  routeNames: Record<string, string>;
  preferences: Record<string, unknown>;
}

export interface RestoreResult {
  sectionsRestored: number;
  sectionsFailed: { name: string; reason: string }[];
  namesApplied: number;
  namesSkipped: number;
  preferencesRestored: number;
}

export async function createBackup(): Promise<string> {
  const engine = getRouteEngine();

  // Collect custom sections (slim format — no polyline or distanceMeters)
  const customSections: BackupCustomSection[] = [];
  if (engine) {
    const sections = engine.getSectionsByType('custom');
    for (const s of sections) {
      customSections.push({
        name: s.name || '',
        sportType: s.sportType,
        sourceActivityId: s.sourceActivityId || '',
        startIndex: s.startIndex ?? 0,
        endIndex: s.endIndex ?? 0,
      });
    }
  }

  // Collect names
  const sectionNames = engine?.getAllSectionNames() ?? {};
  const routeNames = engine?.getAllRouteNames() ?? {};

  // Collect preferences
  const preferences: Record<string, unknown> = {};
  for (const key of PREFERENCE_KEYS) {
    try {
      const value = await AsyncStorage.getItem(key);
      if (value !== null) {
        try {
          preferences[key] = JSON.parse(value);
        } catch {
          preferences[key] = value;
        }
      }
    } catch {
      // Skip unreadable keys
    }
  }

  const backup: BackupData = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    customSections,
    sectionNames,
    routeNames,
    preferences,
  };

  return JSON.stringify(backup, null, 2);
}

export async function exportBackup(): Promise<void> {
  const json = await createBackup();
  const date = new Date().toISOString().split('T')[0];
  await shareFile({
    content: json,
    filename: `veloq-backup-${date}.veloq`,
    mimeType: 'application/json',
  });
}

export async function restoreBackup(json: string): Promise<RestoreResult> {
  let backup: BackupData;
  try {
    backup = JSON.parse(json);
  } catch {
    throw new Error('Invalid backup file format');
  }

  if (!backup.version || backup.version > BACKUP_VERSION) {
    throw new Error(
      `Unsupported backup version: ${backup.version}. This app supports version ${BACKUP_VERSION}.`
    );
  }

  const result: RestoreResult = {
    sectionsRestored: 0,
    sectionsFailed: [],
    namesApplied: 0,
    namesSkipped: 0,
    preferencesRestored: 0,
  };

  const engine = getRouteEngine();

  // Restore custom sections
  if (engine && backup.customSections?.length) {
    for (const cs of backup.customSections) {
      try {
        if (!cs.sourceActivityId) {
          result.sectionsFailed.push({
            name: cs.name || 'Unnamed',
            reason: 'No source activity ID',
          });
          continue;
        }

        // Check if source activity exists
        const track = engine.getGpsTrack(cs.sourceActivityId);
        if (!track || track.length === 0) {
          result.sectionsFailed.push({
            name: cs.name || 'Unnamed',
            reason: 'Source activity not synced',
          });
          continue;
        }

        // Validate indices are within track bounds
        if (cs.startIndex >= track.length || cs.endIndex >= track.length) {
          result.sectionsFailed.push({
            name: cs.name || 'Unnamed',
            reason: `Indices out of range (${cs.startIndex}-${cs.endIndex} vs track length ${track.length})`,
          });
          continue;
        }

        const sectionId = engine.createSectionFromIndices(
          cs.sourceActivityId,
          cs.startIndex,
          cs.endIndex,
          cs.sportType,
          cs.name || undefined
        );
        if (!sectionId) {
          result.sectionsFailed.push({
            name: cs.name || 'Unnamed',
            reason: 'Engine returned empty section ID',
          });
          continue;
        }
        result.sectionsRestored++;
      } catch {
        result.sectionsFailed.push({
          name: cs.name || 'Unnamed',
          reason: 'Creation failed',
        });
      }
    }
  }

  // Restore section names
  if (engine && backup.sectionNames) {
    for (const [id, name] of Object.entries(backup.sectionNames)) {
      try {
        engine.setSectionName(id, name);
        result.namesApplied++;
      } catch {
        result.namesSkipped++;
      }
    }
  }

  // Restore route names
  if (engine && backup.routeNames) {
    for (const [id, name] of Object.entries(backup.routeNames)) {
      try {
        engine.setRouteName(id, name);
        result.namesApplied++;
      } catch {
        result.namesSkipped++;
      }
    }
  }

  // Restore preferences
  if (backup.preferences) {
    for (const [key, value] of Object.entries(backup.preferences)) {
      try {
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
        await AsyncStorage.setItem(key, stringValue);
        result.preferencesRestored++;
      } catch {
        // Skip unwritable keys
      }
    }
  }

  return result;
}
