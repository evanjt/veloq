/**
 * What a module that must not load the Activity components needs: opening a
 * day's activities from another screen's chart. `scripts/lint-feature-imports.mjs`
 * counts an import of it as a barrel import.
 */
export {
  dayActivityRow,
  useOpenDayActivities,
  type DayActivity,
} from './hooks/useOpenDayActivities';
