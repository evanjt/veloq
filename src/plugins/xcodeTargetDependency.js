/**
 * `pbxProject.addTargetDependency` writes the dependency only when both
 * `PBXTargetDependency` and `PBXContainerItemProxy` are already in the project,
 * and it creates neither (`node_modules/xcode/lib/pbxProject.js:860`). A project
 * from `expo prebuild` carries neither section, so every call returned a value
 * and wrote nothing, and what built the extensions was the scheme's "Find
 * Implicit Dependencies" resolving the product the app's Copy Files phase names.
 * With that off, or building the app target directly, the embed phase copies a
 * `.appex` nobody built and the error names a missing file.
 *
 * `addTarget` adds the dependency itself for anything but a watch extension, so
 * a plugin only has to make the sections exist before it creates the target.
 */
function ensureTargetDependencySections(proj) {
  const objects = proj.hash.project.objects;
  for (const section of ["PBXTargetDependency", "PBXContainerItemProxy"]) {
    if (!objects[section]) objects[section] = {};
  }
  return proj;
}

module.exports = { ensureTargetDependencySections };
