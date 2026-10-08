const { withMainActivity, AndroidConfig, CodeGenerator } = require("expo/config-plugins");

/**
 * Expo config plugin that makes each intent delivered to `MainActivity` its
 * own intent.
 *
 * The activity is `singleTask`. When the system kills the process but keeps the
 * task, a widget, shortcut or notification tap recreates the activity with the
 * intent the task first started with and passes the tapped link to
 * `onNewIntent`. React Native drops that link while the app is still loading,
 * and `getInitialURL` reads the activity's intent, so without this the launch
 * link is the stale first one.
 */

const OVERRIDE = `  override fun onNewIntent(intent: Intent) {
    setIntent(intent)
    super.onNewIntent(intent)
  }`;

/** Add the override to a Kotlin `MainActivity`, once however often it runs. */
function withNewIntentKept(contents) {
  const imported = AndroidConfig.CodeMod.addImports(contents, ["android.content.Intent"], false);
  return CodeGenerator.mergeContents({
    src: imported,
    newSrc: OVERRIDE,
    tag: "veloq-new-intent",
    anchor: /^class MainActivity\b.*\{\s*$/,
    offset: 1,
    comment: "  //",
  }).contents;
}

function withAndroidNewIntent(config) {
  return withMainActivity(config, (mod) => {
    if (mod.modResults.language !== "kt") {
      throw new Error("with-android-new-intent expects a Kotlin MainActivity");
    }
    mod.modResults.contents = withNewIntentKept(mod.modResults.contents);
    return mod;
  });
}

module.exports = withAndroidNewIntent;
module.exports.withNewIntentKept = withNewIntentKept;
