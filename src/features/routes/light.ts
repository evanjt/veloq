/**
 * The hooks and helpers other features take from routes without loading its
 * components. `scripts/lint-feature-imports.mjs` counts an import of this file
 * as a barrel import and fails it if it ever re-exports with `export *` or
 * reaches `./components` or `./index`.
 */
export { useRouteGroups } from './hooks/useRouteGroups';
