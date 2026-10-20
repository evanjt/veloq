/**
 * The App Store App Privacy answers and the Play Data safety answers, held as
 * one record in the tree and checked against `app.json` and across the two
 * stores.
 *
 * The consoles are set from `config/fastlane/metadata/store-privacy-declarations.json`.
 * Nothing uploads it: whoever changes a console answer changes the record in
 * the same change, and whoever adds a permission or a plugin to `app.json`
 * says in the record what it collects or why it collects nothing.
 */

import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..');

export const PRIVACY_RECORD_PATH = path.join(
  PROJECT_ROOT,
  'config',
  'fastlane',
  'metadata',
  'store-privacy-declarations.json'
);

export const APP_JSON_PATH = path.join(PROJECT_ROOT, 'app.json');

/**
 * Why a capability reaches no store's definition of collection.
 * - `onDevice`: the data never leaves the device.
 * - `ephemeral`: held off the device only long enough to serve the request.
 * - `athletesOwnAccount`: sent only to an account of the athlete's own, their
 *   intervals.icu account or their iCloud Drive or Google Drive, which neither
 *   store counts, since neither the developer nor a partner of the developer
 *   can read it.
 */
export const NOT_COLLECTED_REASONS = ['onDevice', 'ephemeral', 'athletesOwnAccount'] as const;
export type NotCollectedReason = (typeof NOT_COLLECTED_REASONS)[number];

/** Something the server keeps, which a store declaration has to account for. */
export interface ServerHeldItem {
  id: string;
  what: string;
  source: string;
  /** Kept only long enough to serve one request, so no store counts it. */
  ephemeral: boolean;
  /** Filed under the athlete's account id, so it is linked to the athlete. */
  linkedToAthlete: boolean;
  /** Every way the item leaves the server. Empty when it cannot be removed. */
  deletion: string[];
}

export interface NotCollectedEntry {
  what: string;
  carriers: string[];
  reason: NotCollectedReason;
  note: string;
}

export interface NoUserDataEntry {
  carriers: string[];
  note: string;
}

export interface AppStoreDataType {
  category: string;
  type: string;
  purposes: string[];
  linked: boolean;
  tracking: boolean;
  holds: string[];
  carriers: string[];
}

export interface PlayDataType {
  category: string;
  type: string;
  purposes: string[];
  optional: boolean;
  shared: boolean;
  ephemeral: boolean;
  holds: string[];
  carriers: string[];
}

export interface StorePrivacyRecord {
  serverHeld: ServerHeldItem[];
  noUserData: NoUserDataEntry[];
  appStore: {
    tracking: boolean;
    dataTypes: AppStoreDataType[];
    notCollected: NotCollectedEntry[];
  };
  play: {
    encryptedInTransit: boolean;
    deletion: { userCanRequest: boolean; paths: string[] };
    dataTypes: PlayDataType[];
    notCollected: NotCollectedEntry[];
  };
}

interface AppJsonShape {
  expo?: {
    ios?: { infoPlist?: Record<string, unknown> };
    android?: { permissions?: string[] };
    plugins?: (string | [string, ...unknown[]])[];
  };
}

/**
 * Every capability `app.json` grants the app that could reach user data, as
 * the carrier names the record uses: `permission:X` for an Android
 * permission, `backgroundMode:X` for an iOS background mode,
 * `usageDescription:X` for an iOS permission prompt and `plugin:X` for a
 * package plugin. The repository's own plugins under `./` change the build
 * and grant nothing a permission does not already name.
 */
export function appJsonCarriers(appJson: unknown): string[] {
  const expo = (appJson as AppJsonShape).expo ?? {};
  const carriers = new Set<string>();
  for (const permission of expo.android?.permissions ?? []) {
    carriers.add(`permission:${permission.replace(/^android\.permission\./, '')}`);
  }
  const infoPlist = expo.ios?.infoPlist ?? {};
  const modes = infoPlist.UIBackgroundModes;
  for (const mode of Array.isArray(modes) ? modes : []) {
    carriers.add(`backgroundMode:${String(mode)}`);
  }
  for (const key of Object.keys(infoPlist)) {
    if (key.endsWith('UsageDescription')) carriers.add(`usageDescription:${key}`);
  }
  for (const plugin of expo.plugins ?? []) {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    if (!name.startsWith('./')) carriers.add(`plugin:${name}`);
  }
  return [...carriers].sort();
}

type StoreName = 'appStore' | 'play';

function storeAccounts(record: StorePrivacyRecord, store: StoreName): Map<string, string> {
  const accounted = new Map<string, string>();
  for (const entry of record.noUserData) {
    for (const carrier of entry.carriers) accounted.set(carrier, 'noUserData');
  }
  for (const dataType of record[store].dataTypes) {
    for (const carrier of dataType.carriers) accounted.set(carrier, dataType.type);
  }
  for (const entry of record[store].notCollected) {
    for (const carrier of entry.carriers) accounted.set(carrier, entry.what);
  }
  return accounted;
}

function heldBy(record: StorePrivacyRecord, store: StoreName): Set<string> {
  return new Set(record[store].dataTypes.flatMap((d) => d.holds));
}

/**
 * Every way the record fails `app.json` or disagrees with itself, one line
 * each. Empty when the record accounts for every capability, both stores
 * declare the same server-held items, and the deletion answer matches the
 * deletion paths the server has.
 */
export function privacyDeclarationGaps(appJson: unknown, record: StorePrivacyRecord): string[] {
  const gaps: string[] = [];
  const carriers = appJsonCarriers(appJson);
  const stores: StoreName[] = ['appStore', 'play'];

  for (const store of stores) {
    const accounted = storeAccounts(record, store);
    for (const carrier of carriers) {
      if (!accounted.has(carrier)) {
        gaps.push(
          `${store}: ${carrier} is in app.json but neither declared nor listed as not collected`
        );
      }
    }
    for (const carrier of accounted.keys()) {
      if (!carriers.includes(carrier)) {
        gaps.push(`${store}: ${carrier} is in the record but not in app.json`);
      }
    }
    for (const entry of record[store].notCollected) {
      if (!(NOT_COLLECTED_REASONS as readonly string[]).includes(entry.reason)) {
        gaps.push(`${store}: ${entry.what} gives no reason it is not collected`);
      }
    }
  }

  const known = new Map(record.serverHeld.map((item) => [item.id, item]));
  const declared = { appStore: heldBy(record, 'appStore'), play: heldBy(record, 'play') };
  for (const store of stores) {
    for (const id of declared[store]) {
      if (!known.has(id)) gaps.push(`${store}: declares ${id}, which the server does not hold`);
    }
  }
  for (const item of record.serverHeld) {
    if (item.ephemeral) continue;
    for (const store of stores) {
      if (!declared[store].has(item.id)) {
        const other = stores.find((s) => s !== store) as StoreName;
        gaps.push(
          declared[other].has(item.id)
            ? `${store}: does not declare ${item.id}, which ${other} declares`
            : `${store}: does not declare ${item.id}, which the server keeps`
        );
      }
    }
  }
  for (const dataType of record.appStore.dataTypes) {
    const linkedItems = dataType.holds.filter((id) => known.get(id)?.linkedToAthlete);
    if (linkedItems.length > 0 && !dataType.linked) {
      gaps.push(
        `appStore: ${dataType.type} is declared not linked, but ${linkedItems.join(', ')} ` +
          `is filed under the athlete's account`
      );
    }
  }

  const deletable = record.serverHeld.filter((item) => !item.ephemeral && item.deletion.length > 0);
  if (deletable.length > 0 && !record.play.deletion.userCanRequest) {
    gaps.push(
      `play: says data cannot be deleted, but ${deletable.map((i) => i.id).join(', ')} ` +
        `can be (${[...new Set(deletable.flatMap((i) => i.deletion))].join('; ')})`
    );
  }

  return gaps;
}

export function loadPrivacyRecord(): StorePrivacyRecord {
  return JSON.parse(fs.readFileSync(PRIVACY_RECORD_PATH, 'utf-8')) as StorePrivacyRecord;
}

export function loadAppJson(): unknown {
  return JSON.parse(fs.readFileSync(APP_JSON_PATH, 'utf-8'));
}
