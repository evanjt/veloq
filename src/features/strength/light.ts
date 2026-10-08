/**
 * What the widget snapshot, which runs headless, reads from strength without
 * loading its components. `scripts/lint-feature-imports.mjs` counts an import of
 * this file as a barrel import and fails it if it ever re-exports with
 * `export *` or reaches `./components` or `./index`.
 */
export { MUSCLE_NAME_KEYS } from './lib/muscleNames';
export { demoStrengthSets } from './demo';
