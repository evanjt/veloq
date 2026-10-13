const { withInfoPlist, withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

/**
 * Expo config plugin that declares the app's backup files to the system, so a
 * backup opened from mail, Files or a file manager is offered to the app.
 *
 * iOS exports a type for each of the app's own extensions and lists them as
 * documents it owns. A record backup is a plain zip, so the app is an
 * alternate for every zip archive rather than its owner. An opened file is
 * copied into the app, never edited where it lies.
 *
 * Android gets a VIEW filter for a zip and one for each own extension. A
 * content provider rarely names the file in its path, so the extension filter
 * catches a file manager's and the zip filter carries the rest; the restore
 * reads the file's first bytes when the name says nothing. A shared file comes
 * through expo-sharing's SEND filter, declared beside this plugin in the app
 * config.
 */

/** The legacy settings backup, a JSON file. */
const BACKUP_TYPE = {
  UTTypeIdentifier: "com.veloq.app.backup",
  UTTypeDescription: "Veloq Backup",
  UTTypeConformsTo: ["public.json", "public.data"],
  UTTypeTagSpecification: { "public.filename-extension": ["veloq"] },
};

/** The legacy database backup, an SQLite file. */
const DATABASE_BACKUP_TYPE = {
  UTTypeIdentifier: "com.veloq.app.database-backup",
  UTTypeDescription: "Veloq Database Backup",
  UTTypeConformsTo: ["public.data"],
  UTTypeTagSpecification: { "public.filename-extension": ["veloqdb"] },
};

const DOCUMENT_TYPES = [
  {
    CFBundleTypeName: BACKUP_TYPE.UTTypeDescription,
    CFBundleTypeRole: "Viewer",
    LSHandlerRank: "Owner",
    LSItemContentTypes: [BACKUP_TYPE.UTTypeIdentifier],
  },
  {
    CFBundleTypeName: DATABASE_BACKUP_TYPE.UTTypeDescription,
    CFBundleTypeRole: "Viewer",
    LSHandlerRank: "Owner",
    LSItemContentTypes: [DATABASE_BACKUP_TYPE.UTTypeIdentifier],
  },
  {
    CFBundleTypeName: "Zip Archive",
    CFBundleTypeRole: "Viewer",
    LSHandlerRank: "Alternate",
    LSItemContentTypes: ["public.zip-archive"],
  },
];

/** Replace the entries this plugin owns by key, keeping any another plugin added. */
function mergeBy(existing, own, key) {
  const ours = new Set(own.map((entry) => entry[key]));
  return [...(existing ?? []).filter((entry) => !ours.has(entry[key])), ...own];
}

function setBackupDocumentTypes(plist) {
  return {
    ...plist,
    UTExportedTypeDeclarations: mergeBy(
      plist.UTExportedTypeDeclarations,
      [BACKUP_TYPE, DATABASE_BACKUP_TYPE],
      "UTTypeIdentifier"
    ),
    CFBundleDocumentTypes: mergeBy(plist.CFBundleDocumentTypes, DOCUMENT_TYPES, "CFBundleTypeName"),
    LSSupportsOpeningDocumentsInPlace: false,
  };
}

/** The tag marking a filter this plugin wrote, so a second run replaces it. */
const GENERATED_TAG = "veloq-backup-file-types";

const action = (name) => ({ $: { "android:name": name } });
const VIEW = action("android.intent.action.VIEW");
const DEFAULT = action("android.intent.category.DEFAULT");

/** A backslash before the dot, escaped once for the XML resource reader. */
const endingIn = (extension) => `.*\\\\.${extension}`;

const VIEW_FILTERS = [
  {
    $: { [GENERATED_TAG]: "true" },
    action: [VIEW],
    category: [DEFAULT],
    data: [
      { $: { "android:scheme": "content" } },
      { $: { "android:scheme": "file" } },
      { $: { "android:mimeType": "application/zip" } },
    ],
  },
  {
    $: { [GENERATED_TAG]: "true" },
    action: [VIEW],
    category: [DEFAULT],
    data: [
      { $: { "android:scheme": "content" } },
      { $: { "android:scheme": "file" } },
      { $: { "android:host": "*" } },
      { $: { "android:mimeType": "*/*" } },
      { $: { "android:pathPattern": endingIn("veloq") } },
      { $: { "android:pathPattern": endingIn("veloqdb") } },
    ],
  },
];

function setBackupIntentFilters(manifest) {
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
  const kept = (activity["intent-filter"] ?? []).filter(
    (filter) => filter.$?.[GENERATED_TAG] !== "true"
  );
  activity["intent-filter"] = [...kept, ...VIEW_FILTERS];
  return manifest;
}

function withBackupFileTypes(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults = setBackupDocumentTypes(mod.modResults);
    return mod;
  });
  return withAndroidManifest(config, (mod) => {
    mod.modResults = setBackupIntentFilters(mod.modResults);
    return mod;
  });
}

module.exports = withBackupFileTypes;
