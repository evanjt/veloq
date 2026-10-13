/**
 * The settings stores other features read without loading its components: maps,
 * whose barrel settings' own components import, and the widget snapshot, which
 * runs headless. Beside them, the one owner of where an exported file or a
 * shared link goes, which the recording screen, the feed card and the debug
 * screen reach.
 * `scripts/lint-feature-imports.mjs` counts an import of this file as a barrel
 * import and fails it if it ever re-exports with `export *` or reaches
 * `./components` or `./index`.
 */
export { useMapPreferences } from './stores/MapPreferencesContext';
export {
  useDashboardPreferences,
  type SummaryCardPreferences,
} from './stores/summaryCardPreferences';
export { presentActivityNotification } from './lib/notificationService';
export { refreshPushTokenRegistration } from './lib/pushTokenRegistration';
export { shareCopyAs, shareText, type ShareAnchor } from './lib/shareFile';
export type { NotificationPreferences } from './stores/NotificationPreferencesStore';
