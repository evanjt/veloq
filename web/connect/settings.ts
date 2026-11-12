// The connect page's settings: which of the phone's settings screens the page
// lays out, which it keeps to the phone, and what each address shows. Pure, so
// a test drives it without a browser.
//
// The rows are the phone's own settings hub in its own groups. A row whose
// screen the page reads opens a readable pane; a screen the phone keeps to
// itself opens a pane that says why and carries no control.

/** A settings screen the page lays out on the left. */
export type SettingsRow = { screen: string; title: string };

/** One group of rows, under the phone's own heading. */
export type SettingsGroup = { title: string; rows: SettingsRow[] };

/** An entry the phone keeps to itself, and the one sentence on why. */
export type PhoneOnly = { title: string; why: string; screen?: string };

/** What the right-hand pane shows for an address. */
export type Pane =
  | { kind: 'hub' }
  | { kind: 'readable'; title: string; note: string; body: string }
  | { kind: 'phone'; title: string; why: string }
  | { kind: 'unknown' };

/** The one line at the top of every readable pane until the writes land. */
export const PANE_NOTE = 'Changes are made on the phone for now.';

/** What a readable pane says while the page does not read its values. */
export const PANE_BODY = 'This page does not read this setting yet. Open it on your phone.';

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: 'Appearance',
    rows: [
      { screen: 'display-settings', title: 'Display' },
      { screen: 'map-settings', title: 'Maps' },
      { screen: 'summary-card-settings', title: 'Summary card' },
    ],
  },
  {
    title: 'Data & recording',
    rows: [{ screen: 'notification-settings', title: 'Notifications' }],
  },
  {
    title: 'Library & backup',
    rows: [
      { screen: 'detection-settings', title: 'Routes and sections' },
      { screen: 'backup-settings', title: 'Backup' },
      { screen: 'linked-devices', title: 'Linked devices' },
      { screen: 'cache-settings', title: 'Storage' },
    ],
  },
];

/** What the phone keeps to itself, each with its reason. */
export const ON_THE_PHONE: PhoneOnly[] = [
  {
    title: 'Sensors',
    screen: 'sensor-settings',
    why: "Heart-rate straps and power meters pair over the phone's own Bluetooth, which a browser cannot reach.",
  },
  {
    title: 'Recording',
    screen: 'recording-settings',
    why: "A recording runs on the phone's sensors and in its background service, so it starts and stops there.",
  },
  {
    title: 'Account',
    why: 'Signing in and out holds the intervals.icu login, which stays on the phone.',
  },
  {
    title: 'Backup and restore',
    why: 'A restore replaces the library on the phone, and the backup files are kept there.',
  },
  {
    title: 'Garmin connector',
    why: 'The Garmin key is a credential, and it stays on the phone.',
  },
  {
    title: 'Clear cache',
    why: 'Clearing the cache deletes files on the phone that this browser does not hold.',
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
    if (row) return { kind: 'readable', title: row.title, note: PANE_NOTE, body: PANE_BODY };
  }
  const phone = ON_THE_PHONE.find((entry) => entry.screen === screen);
  if (phone) return { kind: 'phone', title: phone.title, why: phone.why };
  return { kind: 'unknown' };
}
