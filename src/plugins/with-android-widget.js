const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

/**
 * Registers the home-screen widget's AppWidgetProvider <receiver> in the Android
 * manifest. The repo builds from committed native dirs (no prebuild), so the receiver
 * is also present in android/app/src/main/AndroidManifest.xml directly; this plugin
 * keeps it idempotent if a prebuild is ever run. The widget's layouts, drawables,
 * res/xml/veloq_widget_info.xml and Kotlin sources are committed under
 * android/app/src/main and are not generated here.
 */

const RECEIVER_NAME = ".widget.VeloqWidgetProvider";

module.exports = function withAndroidWidget(config) {
  return withAndroidManifest(config, (mod) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    app.receiver = app.receiver || [];

    const exists = app.receiver.some((r) => r.$?.["android:name"] === RECEIVER_NAME);
    if (!exists) {
      app.receiver.push({
        $: { "android:name": RECEIVER_NAME, "android:exported": "true" },
        "intent-filter": [
          {
            action: [{ $: { "android:name": "android.appwidget.action.APPWIDGET_UPDATE" } }],
          },
        ],
        "meta-data": [
          {
            $: {
              "android:name": "android.appwidget.provider",
              "android:resource": "@xml/veloq_widget_info",
            },
          },
        ],
      });
    }
    return mod;
  });
};
