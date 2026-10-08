/**
 * The settings stores other features read without loading its components: maps,
 * whose barrel settings' own components import, and the widget snapshot, which
 * runs headless. `scripts/lint-feature-imports.mjs` counts an import of this
 * file as a barrel import and fails it if it ever re-exports with `export *` or
 * reaches `./components` or `./index`.
 */
export { useMapPreferences } from './stores/MapPreferencesContext';
export {
  useDashboardPreferences,
  type SummaryCardPreferences,
} from './stores/summaryCardPreferences';
export { presentActivityNotification } from './lib/notificationService';
export { refreshPushTokenRegistration } from './lib/pushTokenRegistration';
export type { NotificationPreferences } from './stores/NotificationPreferencesStore';
