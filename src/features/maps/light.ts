/**
 * The map stores other features read without loading its components: the
 * saved 3D camera per activity, which the map preferences write beside the
 * activity's 3D mode and which settings' headless path loads.
 * `scripts/lint-feature-imports.mjs` counts an import of this file as a barrel
 * import and fails it if it ever re-exports with `export *` or reaches
 * `./components` or `./index`.
 */
export {
  deleteCameraOverride,
  getCameraOverride,
  getCameraOverridesSnapshot,
  setCameraOverride,
  subscribeCameraOverrides,
} from './lib/storage/terrainCameraOverrides';
