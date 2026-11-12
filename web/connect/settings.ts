// The connect page's settings: which of the phone's settings screens the page
// lays out, which it keeps to the phone, and what each address shows. Pure, so
// a test drives it without a browser.
//
// The rows are the phone's own settings hub in its own groups. A row whose
// screen the page reads opens a readable pane; a screen the phone keeps to
// itself opens a pane that says why and carries no control.

import type { ParseKeys } from 'i18next';

/** A settings screen the page lays out on the left. */
export type SettingsRow = { screen: string; title: ParseKeys };

/** One group of rows, under the phone's own heading. */
export type SettingsGroup = { title: ParseKeys; rows: SettingsRow[] };

/** An entry the phone keeps to itself, and the one sentence on why. */
export type PhoneOnly = { title: ParseKeys; why: ParseKeys; screen?: string };

/** What the right-hand pane shows for an address. */
export type Pane =
  | { kind: 'hub' }
  | { kind: 'readable'; title: ParseKeys; note: ParseKeys }
  | { kind: 'phone'; title: ParseKeys; why: ParseKeys }
  | { kind: 'unknown' };

/** The key of the one line at the top of every readable pane until the writes land. */
export const PANE_NOTE: ParseKeys = 'connectPage.settings.paneNote';

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: 'connectPage.settings.groups.appearance',
    rows: [
      { screen: 'display-settings', title: 'connectPage.settings.rows.display' },
      { screen: 'map-settings', title: 'connectPage.settings.rows.maps' },
      { screen: 'summary-card-settings', title: 'connectPage.settings.rows.summaryCard' },
    ],
  },
  {
    title: 'connectPage.settings.groups.dataRecording',
    rows: [{ screen: 'notification-settings', title: 'connectPage.settings.rows.notifications' }],
  },
  {
    title: 'connectPage.settings.groups.libraryBackup',
    rows: [
      { screen: 'detection-settings', title: 'connectPage.settings.rows.detection' },
      { screen: 'backup-settings', title: 'connectPage.settings.rows.backup' },
      { screen: 'linked-devices', title: 'connectPage.settings.rows.linkedDevices' },
      { screen: 'cache-settings', title: 'connectPage.settings.rows.storage' },
    ],
  },
];

/** What the phone keeps to itself, each with its reason. */
export const ON_THE_PHONE: PhoneOnly[] = [
  {
    title: 'connectPage.settings.phoneOnly.sensors.title',
    screen: 'sensor-settings',
    why: 'connectPage.settings.phoneOnly.sensors.why',
  },
  {
    title: 'connectPage.settings.phoneOnly.recording.title',
    screen: 'recording-settings',
    why: 'connectPage.settings.phoneOnly.recording.why',
  },
  {
    title: 'connectPage.settings.phoneOnly.account.title',
    why: 'connectPage.settings.phoneOnly.account.why',
  },
  {
    title: 'connectPage.settings.phoneOnly.backupRestore.title',
    why: 'connectPage.settings.phoneOnly.backupRestore.why',
  },
  {
    title: 'connectPage.settings.phoneOnly.garmin.title',
    why: 'connectPage.settings.phoneOnly.garmin.why',
  },
  {
    title: 'connectPage.settings.phoneOnly.clearCache.title',
    why: 'connectPage.settings.phoneOnly.clearCache.why',
  },
];

/**
 * What an address under `#/settings` shows. No screen is the hub; a screen
 * the page lays out is readable; one the phone keeps is named with its
 * reason; anything else is not on the browser yet.
 */
export function pane(screen: string | null): Pane {
  if (!screen) return { kind: 'hub' };
  for (const group of SETTINGS_GROUPS) {
    const row = group.rows.find((candidate) => candidate.screen === screen);
    if (row) return { kind: 'readable', title: row.title, note: PANE_NOTE };
  }
  const phone = ON_THE_PHONE.find((entry) => entry.screen === screen);
  if (phone) return { kind: 'phone', title: phone.title, why: phone.why };
  return { kind: 'unknown' };
}

/** One option of a choice control. */
export type ChoiceOption = { value: string; label: ParseKeys };

/**
 * A control a readable pane draws from the phone's read. Every one is
 * disabled until the page can write; `value` is what the phone holds, or null
 * when the setting is not set there.
 */
export type PaneControl =
  | {
      kind: 'choice';
      key: string;
      label: ParseKeys;
      value: string | null;
      options: ChoiceOption[];
      disabled: true;
    }
  | { kind: 'text'; key: string; label: ParseKeys; value: string | null; disabled: true };

type SettingSpec = { label: ParseKeys; options?: ChoiceOption[] };

const SETTING_SPECS: Readonly<Record<string, SettingSpec>> = {
  'veloq-theme-preference': {
    label: 'connectPage.settings.values.theme',
    options: [
      { value: 'system', label: 'connectPage.settings.options.system' },
      { value: 'light', label: 'connectPage.settings.options.light' },
      { value: 'dark', label: 'connectPage.settings.options.dark' },
    ],
  },
  'veloq-language-preference': { label: 'connectPage.settings.values.language' },
  'veloq-unit-preference': {
    label: 'connectPage.settings.values.units',
    options: [
      { value: 'auto', label: 'connectPage.settings.options.auto' },
      { value: 'metric', label: 'connectPage.settings.options.metric' },
      { value: 'imperial', label: 'connectPage.settings.options.imperial' },
    ],
  },
  'veloq-primary-sport': { label: 'connectPage.settings.values.primarySport' },
  'veloq-wellness-smoothing': { label: 'connectPage.settings.values.wellnessSmoothing' },
  'veloq-map-preferences': { label: 'connectPage.settings.values.map' },
  dashboard_summary_card: { label: 'connectPage.settings.values.summaryCard' },
  'veloq-notification-preferences': { label: 'connectPage.settings.values.notifications' },
  'veloq-route-settings': { label: 'connectPage.settings.values.routes' },
};

/** The settings each readable screen draws, by the screen's address. */
export const SCREEN_SETTINGS: Readonly<Record<string, readonly string[]>> = {
  'display-settings': [
    'veloq-theme-preference',
    'veloq-language-preference',
    'veloq-unit-preference',
    'veloq-primary-sport',
    'veloq-wellness-smoothing',
  ],
  'map-settings': ['veloq-map-preferences'],
  'summary-card-settings': ['dashboard_summary_card'],
  'notification-settings': ['veloq-notification-preferences'],
  'detection-settings': ['veloq-route-settings'],
};

/** The controls of a readable screen, every one disabled, from the phone's `settings.get`. */
export function paneControls(
  screen: string,
  answer: { values: { key: string; value: string | null }[] } | undefined
): PaneControl[] {
  const keys = SCREEN_SETTINGS[screen];
  if (!keys || !answer) return [];
  const held = new Map(answer.values.map((entry) => [entry.key, entry.value]));
  return keys.flatMap((key): PaneControl[] => {
    const spec = SETTING_SPECS[key];
    if (!spec || !held.has(key)) return [];
    const value = held.get(key) ?? null;
    return [
      spec.options
        ? { kind: 'choice', key, label: spec.label, value, options: spec.options, disabled: true }
        : { kind: 'text', key, label: spec.label, value, disabled: true },
    ];
  });
}

/**
 * The unit system figures are written in: the phone's own choice when it made
 * one, else the intervals.icu profile's measurement preference, else metric.
 */
export function unitSystem(
  preference: string | null | undefined,
  measurement: string | null | undefined
): 'metric' | 'imperial' {
  if (preference === 'metric' || preference === 'imperial') return preference;
  return measurement === 'feet' ? 'imperial' : 'metric';
}

const STATUS_SCREENS = new Set(['linked-devices', 'backup-settings', 'cache-settings']);

/** Whether the page reads the values of a screen from the phone. */
export const readsScreen = (screen: string) =>
  screen in SCREEN_SETTINGS || STATUS_SCREENS.has(screen);
