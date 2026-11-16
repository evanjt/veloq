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
  | { kind: 'readable'; title: ParseKeys; note: ParseKeys | null }
  | { kind: 'phone'; title: ParseKeys; why: ParseKeys }
  | { kind: 'unknown' };

/** The key of the one line at the top of every readable pane whose values are not written here yet. */
export const PANE_NOTE: ParseKeys = 'connectPage.settings.paneNote';

/** The key of the line at the top of the display pane: what it writes and what stays on the phone. */
export const DISPLAY_NOTE: ParseKeys = 'connectPage.settings.displayNote';

/** The screen whose pane writes, drawn by the detection pane. */
export const DETECTION_SCREEN = 'detection-settings';

/** The screen that shows the athlete's profile and the source of each value. */
export const PROFILE_SCREEN = 'profile-settings';

/** The screen whose table sets each sport's thresholds and shows the zones. */
export const THRESHOLDS_SCREEN = 'thresholds-settings';

/** The screen whose choices write through `settings.set`. */
export const DISPLAY_SCREEN = 'display-settings';

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: 'connectPage.settings.groups.athlete',
    rows: [
      { screen: PROFILE_SCREEN, title: 'connectPage.settings.rows.profile' },
      { screen: THRESHOLDS_SCREEN, title: 'connectPage.settings.rows.thresholds' },
    ],
  },
  {
    title: 'connectPage.settings.groups.appearance',
    rows: [
      { screen: DISPLAY_SCREEN, title: 'connectPage.settings.rows.display' },
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
      { screen: DETECTION_SCREEN, title: 'connectPage.settings.rows.detection' },
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
    screen: 'account-settings',
    why: 'connectPage.settings.phoneOnly.account.why',
  },
  {
    title: 'connectPage.settings.phoneOnly.backupRestore.title',
    screen: 'backup-restore-settings',
    why: 'connectPage.settings.phoneOnly.backupRestore.why',
  },
  {
    title: 'connectPage.settings.phoneOnly.garmin.title',
    screen: 'garmin-settings',
    why: 'connectPage.settings.phoneOnly.garmin.why',
  },
  {
    title: 'connectPage.settings.phoneOnly.clearCache.title',
    screen: 'clear-cache-settings',
    why: 'connectPage.settings.phoneOnly.clearCache.why',
  },
];

/** The line a readable pane opens with, or null for a pane that writes everything it shows. */
function noteOf(screen: string): ParseKeys | null {
  if (screen === DETECTION_SCREEN || screen === THRESHOLDS_SCREEN) return null;
  return screen === DISPLAY_SCREEN ? DISPLAY_NOTE : PANE_NOTE;
}

/**
 * What an address under `#/settings` shows. No screen is the hub; a screen
 * the page lays out is readable; one the phone keeps is named with its
 * reason; anything else is not on the browser yet.
 */
export function pane(screen: string | null): Pane {
  if (!screen) return { kind: 'hub' };
  for (const group of SETTINGS_GROUPS) {
    const row = group.rows.find((candidate) => candidate.screen === screen);
    if (row) return { kind: 'readable', title: row.title, note: noteOf(row.screen) };
  }
  const phone = ON_THE_PHONE.find((entry) => entry.screen === screen);
  if (phone) return { kind: 'phone', title: phone.title, why: phone.why };
  return { kind: 'unknown' };
}

/** One option of a choice control. */
export type ChoiceOption = { value: string; label: ParseKeys };

/**
 * A control a readable pane draws from the phone's read. A choice is written
 * through `settings.set`; a text is shown and kept to the phone. `value` is
 * what the phone holds, or null when the setting is not set there.
 */
export type PaneControl =
  | {
      kind: 'choice';
      key: string;
      label: ParseKeys;
      value: string | null;
      options: ChoiceOption[];
    }
  | { kind: 'text'; key: string; label: ParseKeys; value: string | null };

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
  'veloq-primary-sport': {
    label: 'connectPage.settings.values.primarySport',
    options: [
      { value: 'Cycling', label: 'connectPage.settings.options.cycling' },
      { value: 'Running', label: 'connectPage.settings.options.running' },
      { value: 'Swimming', label: 'connectPage.settings.options.swimming' },
    ],
  },
  'veloq-wellness-smoothing': { label: 'connectPage.settings.values.wellnessSmoothing' },
  'veloq-map-preferences': { label: 'connectPage.settings.values.map' },
  dashboard_summary_card: { label: 'connectPage.settings.values.summaryCard' },
  'veloq-notification-preferences': { label: 'connectPage.settings.values.notifications' },
  'veloq-route-settings': { label: 'connectPage.settings.values.routes' },
};

/** The settings each readable screen draws, by the screen's address. */
export const SCREEN_SETTINGS: Readonly<Record<string, readonly string[]>> = {
  [DISPLAY_SCREEN]: [
    'veloq-theme-preference',
    'veloq-language-preference',
    'veloq-unit-preference',
    'veloq-primary-sport',
    'veloq-wellness-smoothing',
  ],
  'map-settings': ['veloq-map-preferences'],
  'summary-card-settings': ['dashboard_summary_card'],
  'notification-settings': ['veloq-notification-preferences'],
};

/** The controls of a readable screen, from the phone's `settings.get`. */
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
        ? { kind: 'choice', key, label: spec.label, value, options: spec.options }
        : { kind: 'text', key, label: spec.label, value },
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

/** The page's words for the unit system intervals.icu's `measurementPreference` names. */
export function measurementKey(preference: string | null | undefined): ParseKeys | null {
  if (preference === 'meters') return 'connectPage.settings.options.metric';
  if (preference === 'feet') return 'connectPage.settings.options.imperial';
  return null;
}

const SYNC_STATE_KEYS: Readonly<Record<string, ParseKeys>> = {
  idle: 'connectPage.settings.syncState.idle',
  syncing: 'connectPage.settings.syncState.syncing',
  paused: 'connectPage.settings.syncState.paused',
  authExpired: 'connectPage.settings.syncState.authExpired',
};

/** The page's words for a sync state, or null for a state it has none for. */
export const syncStateKey = (state: string | null | undefined): ParseKeys | null =>
  (state && SYNC_STATE_KEYS[state]) || null;

const STATUS_SCREENS = new Set(['linked-devices', 'backup-settings', 'cache-settings']);

/** Whether the page reads the values of a screen from the phone. */
export const readsScreen = (screen: string) =>
  screen in SCREEN_SETTINGS ||
  screen === DETECTION_SCREEN ||
  screen === PROFILE_SCREEN ||
  screen === THRESHOLDS_SCREEN ||
  STATUS_SCREENS.has(screen);
