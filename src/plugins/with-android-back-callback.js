const { withMainActivity, AndroidConfig, CodeGenerator } = require("expo/config-plugins");

/**
 * Expo config plugin that hands Android's system back to React Native on every
 * Android version.
 *
 * The app opts in to predictive back, so from Android 13 the system delivers
 * back only to the activity's dispatcher callbacks and never to `onBackPressed`.
 * React Native registers its callback only on Android 16 with a targetSdk 36
 * build. Without this one, Android 13 to 15 sends the app home from any screen.
 */

const CALLBACK = "backToReactNative";

const DECLARATION = `  private val ${CALLBACK} = object : OnBackPressedCallback(true) {
    override fun handleOnBackPressed() {
      isEnabled = false
      onBackPressed()
      isEnabled = true
    }
  }`;

// React Native's own condition for registering its callback, mirrored so exactly one is added.
const REGISTRATION = `    if (Build.VERSION.SDK_INT < 36 || applicationInfo.targetSdkVersion < 36) {
      onBackPressedDispatcher.addCallback(this, ${CALLBACK})
    }`;

// The default back goes through the dispatcher, which would hand it straight back to
// React Native. The default may return early, so the callback comes back on the next message.
const DEFAULT_BACK = `    ${CALLBACK}.isEnabled = false
    window.decorView.post { ${CALLBACK}.isEnabled = true }`;

function merge(src, tag, newSrc, anchor) {
  const result = CodeGenerator.mergeContents({
    src,
    newSrc,
    tag,
    anchor,
    offset: 1,
    comment: "  //",
  });
  if (!result.didMerge && !result.contents.includes(`@generated begin ${tag} `)) {
    throw new Error(`with-android-back-callback found no ${anchor} in MainActivity`);
  }
  return result.contents;
}

/** Add the callback to a Kotlin `MainActivity`, once however often it runs. */
function withBackCallback(contents) {
  let src = AndroidConfig.CodeMod.addImports(
    contents,
    ["android.os.Build", "androidx.activity.OnBackPressedCallback"],
    false
  );
  src = merge(src, "veloq-back-callback", DECLARATION, /^class MainActivity\b.*\{\s*$/);
  src = merge(src, "veloq-back-callback-register", REGISTRATION, /^\s*super\.onCreate\(.*\)\s*$/);
  src = merge(
    src,
    "veloq-back-callback-default",
    DEFAULT_BACK,
    /^\s*override fun invokeDefaultOnBackPressed\(\) \{\s*$/
  );
  return src;
}

function withAndroidBackCallback(config) {
  return withMainActivity(config, (mod) => {
    if (mod.modResults.language !== "kt") {
      throw new Error("with-android-back-callback expects a Kotlin MainActivity");
    }
    mod.modResults.contents = withBackCallback(mod.modResults.contents);
    return mod;
  });
}

module.exports = withAndroidBackCallback;
module.exports.withBackCallback = withBackCallback;
