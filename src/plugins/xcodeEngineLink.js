/**
 * Linking the Rust engine into an app extension, shared by the targets that
 * call it directly: the push extension and the widget extension.
 *
 * An extension links the static library itself rather than through the
 * `Veloqrs` pod, which depends on React, and an extension has neither React
 * nor a JavaScript runtime. Each target builds the library with its own phase,
 * for the SDK and architectures of this build, into its temporary directory.
 * The pod's phase builds the same library for the app, but nothing orders a
 * target after the pod, and the builder serialises the phases and compiles
 * once.
 */

const LIBRARY = 'veloqrs_ffi';
const RUST_PHASE = 'Build Rust library';
const RUST_DIR = '$(TARGET_TEMP_DIR)/VeloqrsFFI';
const RUST_SCRIPT =
  '"$SRCROOT/../modules/veloqrs/scripts/xcode-build-rust.sh" "$SRCROOT" "$TARGET_TEMP_DIR/VeloqrsFFI"';

/** A project value with the quotes the writer may or may not have kept. */
function unquoted(value) {
  return String(value ?? '').replace(/^"(.*)"$/, '$1');
}

/**
 * The target's own build configurations, the ones carrying its settings.
 * Matched on the bare name: the pod install saves the project again and
 * drops the quotes a plugin wrote around it.
 */
function targetBuildSettings(proj, productName) {
  const configurations = proj.pbxXCBuildConfigurationSection();
  return Object.values(configurations)
    .map((entry) => entry && entry.buildSettings)
    .filter((settings) => settings && unquoted(settings.PRODUCT_NAME) === productName);
}

/**
 * The settings that link the library: the bridging header that declares the C
 * entries, the link flag and the search path to the archive the phase writes.
 */
function applyEngineLinkSettings(settings, bridgingHeader) {
  // Declared once, for every Swift file in the target. Without it the C entries
  // are unresolved identifiers and the build says nothing about a missing
  // header.
  settings.SWIFT_OBJC_BRIDGING_HEADER = `"${bridgingHeader}"`;
  settings.OTHER_LDFLAGS = `"$(inherited) -l${LIBRARY}"`;
  // A list, because React Native's pod install puts the Swift library path
  // in front of this setting with a string insert, which glues it onto a
  // single path rather than adding one.
  settings.LIBRARY_SEARCH_PATHS = ['"$(inherited)"', `"${RUST_DIR}"`];
  // The phase writes into the Rust tree and the build directory, which a
  // sandboxed script may not touch.
  settings.ENABLE_USER_SCRIPT_SANDBOXING = 'NO';
  // A target written before the phase existed linked one slice of a bundle
  // per SDK. Those paths would now name a library nothing rebuilds.
  for (const key of Object.keys(settings)) {
    if (key.startsWith('"LIBRARY_SEARCH_PATHS[sdk=')) delete settings[key];
  }
}

/**
 * The phase that builds the Rust library, first in the target so it runs
 * before the link. Added to a target an earlier prebuild wrote without it.
 */
function ensureRustPhase(proj, targetUuid) {
  const target = proj.pbxNativeTargetSection()[targetUuid];
  const scripts = proj.hash.project.objects.PBXShellScriptBuildPhase ?? {};
  const present = target.buildPhases.some(
    (phase) => scripts[phase.value] && unquoted(scripts[phase.value].name) === RUST_PHASE
  );
  if (present) return;
  const { uuid, buildPhase } = proj.addBuildPhase(
    [],
    'PBXShellScriptBuildPhase',
    RUST_PHASE,
    targetUuid,
    {
      shellPath: '/bin/sh',
      shellScript: RUST_SCRIPT,
      outputPaths: [`"${RUST_DIR}/lib${LIBRARY}.a"`],
    }
  );
  // The builder decides whether anything changed, from every input of the
  // library, so Xcode runs the phase on every build rather than guessing.
  buildPhase.alwaysOutOfDate = 1;
  const added = target.buildPhases.findIndex((phase) => phase.value === uuid);
  target.buildPhases.unshift(...target.buildPhases.splice(added, 1));
}

/** Link the engine into a target that exists, on a fresh project or a surviving one. */
function linkEngine(proj, targetUuid, productName, bridgingHeader) {
  ensureRustPhase(proj, targetUuid);
  for (const settings of targetBuildSettings(proj, productName)) {
    applyEngineLinkSettings(settings, bridgingHeader);
  }
}

module.exports = {
  LIBRARY,
  RUST_PHASE,
  RUST_DIR,
  applyEngineLinkSettings,
  ensureRustPhase,
  linkEngine,
  targetBuildSettings,
  unquoted,
};
