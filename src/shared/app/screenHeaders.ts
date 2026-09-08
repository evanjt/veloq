/**
 * The navigation chrome for every route the root stack owns, in one place.
 *
 * `null` is a screen that draws its own and takes no header: the tab group,
 * the two auth screens, the redirect, the full-screen recorder, and the three
 * detail screens whose hero sits under the status bar. Everything else takes
 * the platform's header, titled from one i18n key, which is the rule in
 * `src/shared/ui/CLAUDE.md`. A screen has no header code of its own.
 *
 * The tab group's children belong to `(tabs)/_layout`, so they are not here.
 */

import type { ParseKeys } from 'i18next';

export interface ScreenHeader {
  /** i18n key for the title. Resolved in the layout, so the screen stays pure. */
  titleKey?: ParseKeys;
  /** Literal title, for the developer screen, which is not translated. */
  title?: string;
  /** The layout supplies a headerTitle of its own; the key above is what shows until it loads. */
  dynamic?: boolean;
}

export const SCREEN_HEADERS: Record<string, ScreenHeader | null> = {
  '(tabs)': null,
  'activity/[id]': null,
  login: null,
  'oauth/callback': null,
  'recording/[type]': null,
  'route/[id]': null,
  routes: null,
  'section/[id]': null,

  about: { titleKey: 'about.title' },
  account: { titleKey: 'settings.account' },
  'background-jobs': { titleKey: 'backgroundJobs.title' },
  'backup-settings': { titleKey: 'backup.autoBackup' },
  'best-efforts': { titleKey: 'bestEffortsScreen.title' },
  'cache-settings': { titleKey: 'settings.dataCache' },
  'data-sources-settings': { titleKey: 'settings.dataSources' },
  debug: { title: 'Developer Dashboard' },
  'detection-preview': { titleKey: 'settings.previewSections' },
  'detection-settings': { titleKey: 'settings.sectionDetection' },
  'display-settings': { titleKey: 'settings.display' },
  licenses: { titleKey: 'licenses.title' },
  'map-settings': { titleKey: 'settings.maps' },
  'named-corridors': { titleKey: 'namedCorridors.title' },
  'notification-settings': { titleKey: 'notifications.settings.title' },
  record: { titleKey: 'recording.startActivity' },
  'recording-settings': { titleKey: 'recording.settings' },
  'recording/review': { titleKey: 'recording.reviewActivity' },
  'recordings/[id]': { titleKey: 'recording.library.title', dynamic: true },
  'recordings/index': { titleKey: 'recording.library.title' },
  'section-retired': { titleKey: 'sectionHistory.retiredTitle' },
  'sensor-settings': { titleKey: 'sensors.title' },
  settings: { titleKey: 'settings.title' },
  'summary-card-settings': { titleKey: 'settings.summaryCard' },
  'sync-settings': { titleKey: 'settings.localDataRange' },
};
