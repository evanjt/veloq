/**
 * What a module that must not load the Stats components needs: the calendar
 * windows and the view of the calendar, weekly and year parts of the fitness
 * screen read, which the fitness screen's read hook builds and hands down.
 * `scripts/lint-feature-imports.mjs` counts an import of it as a barrel import.
 */
export {
  NO_TRAINING_CARDS,
  trainingCardsView,
  calendarWindows,
  trainingEngineWindows,
  trainingWindows,
  type TrainingCardsRead,
} from './hooks/useEngineStats';
