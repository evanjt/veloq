/**
 * Scenario: a backup arrives as a mail attachment, in Files or in a file manager, or is shared
 * from another app, and the athlete taps it or chooses the app to open it with.
 *
 * Expected behaviour: the config prebuild generates declares the app's own backup types on iOS,
 * lists them and the record zip as documents it opens, and gives the Android main activity a
 * VIEW filter for each type and a SEND filter that hands a shared file to the app.
 */

import path from 'path';

const projectRoot = path.join(__dirname, '../../..');

type Entry = { $: Record<string, string> };
type IntentFilter = { action?: Entry[]; category?: Entry[]; data?: Entry[] };
type Activity = Entry & { 'intent-filter'?: IntentFilter[] };
type Manifest = { manifest: { application?: { activity?: Activity[] }[] } };
type TypeDeclaration = {
  UTTypeIdentifier: string;
  UTTypeConformsTo: string[];
  UTTypeTagSpecification: { 'public.filename-extension': string[] };
};
type DocumentType = {
  CFBundleTypeName: string;
  LSHandlerRank: string;
  LSItemContentTypes: string[];
};
type InfoPlist = {
  UTExportedTypeDeclarations?: TypeDeclaration[];
  CFBundleDocumentTypes?: DocumentType[];
  LSSupportsOpeningDocumentsInPlace?: boolean;
};

/** What prebuild generates from the real config, read without writing `android/` or `ios/`. */
async function generated(platform: 'android' | 'ios') {
  const expo = require.resolve('expo/package.json', { paths: [projectRoot] });
  const { getPrebuildConfigAsync } = require(
    require.resolve('@expo/prebuild-config', { paths: [expo] })
  );
  const { compileModsAsync } = require('expo/config-plugins');
  const { exp } = await getPrebuildConfigAsync(projectRoot, { platforms: [platform] });
  const compiled = await compileModsAsync(exp, {
    projectRoot,
    introspect: true,
    platforms: [platform],
    assertMissingModProviders: false,
  });
  return compiled._internal.modResults[platform];
}

function mainActivityFilters(manifest: Manifest): IntentFilter[] {
  const activity = manifest.manifest.application?.[0]?.activity?.find(
    (entry) => entry.$['android:name'] === '.MainActivity'
  );
  return activity?.['intent-filter'] ?? [];
}

const names = (entries: Entry[] | undefined) => (entries ?? []).map((e) => e.$['android:name']);
const attribute = (filter: IntentFilter, name: string) =>
  (filter.data ?? []).map((datum) => datum.$[`android:${name}`]).filter(Boolean);

describe('the iOS backup document types', () => {
  let plist: InfoPlist;
  beforeAll(async () => {
    plist = (await generated('ios')).infoPlist;
  }, 60_000);

  const declared = (extension: string) =>
    plist.UTExportedTypeDeclarations?.find((type) =>
      type.UTTypeTagSpecification['public.filename-extension'].includes(extension)
    );

  it.each(['veloq', 'veloqdb'])('exports a type for the .%s backup', (extension) => {
    const type = declared(extension);
    expect(type).toBeDefined();
    expect(type!.UTTypeConformsTo).toContain('public.data');
  });

  it('opens its own types as their owner and a zip archive as an alternate', () => {
    const documents = plist.CFBundleDocumentTypes ?? [];
    const rankOf = (uti: string) =>
      documents.find((doc) => doc.LSItemContentTypes.includes(uti))?.LSHandlerRank;
    expect(rankOf(declared('veloq')!.UTTypeIdentifier)).toBe('Owner');
    expect(rankOf(declared('veloqdb')!.UTTypeIdentifier)).toBe('Owner');
    expect(rankOf('public.zip-archive')).toBe('Alternate');
  });

  it('takes a copy of an opened file rather than editing it in place', () => {
    expect(plist.LSSupportsOpeningDocumentsInPlace).toBe(false);
  });
});

describe('the Android backup intent filters', () => {
  let filters: IntentFilter[];
  beforeAll(async () => {
    filters = mainActivityFilters((await generated('android')).manifest);
  }, 60_000);

  const withAction = (action: string) =>
    filters.filter((filter) => names(filter.action).includes(action));

  it('opens a zip archive from a file or a content provider', () => {
    const view = withAction('android.intent.action.VIEW').find((filter) =>
      attribute(filter, 'mimeType').includes('application/zip')
    );
    expect(view).toBeDefined();
    expect(names(view!.category)).toContain('android.intent.category.DEFAULT');
    expect(attribute(view!, 'scheme')).toEqual(expect.arrayContaining(['content', 'file']));
  });

  it.each(['veloq', 'veloqdb'])('opens a file named .%s', (extension) => {
    const view = withAction('android.intent.action.VIEW').find((filter) =>
      attribute(filter, 'pathPattern').some((pattern) => pattern.endsWith(`.${extension}`))
    );
    expect(view).toBeDefined();
    expect(names(view!.category)).toContain('android.intent.category.DEFAULT');
  });

  it('takes a single shared zip or binary file', () => {
    const send = withAction('android.intent.action.SEND');
    const mimeTypes = send.flatMap((filter) => attribute(filter, 'mimeType'));
    expect(mimeTypes).toEqual(
      expect.arrayContaining(['application/zip', 'application/octet-stream'])
    );
    // A filter with no type matches no share, since every share carries one.
    const multiple = withAction('android.intent.action.SEND_MULTIPLE');
    expect(multiple.flatMap((filter) => attribute(filter, 'mimeType'))).toEqual([]);
  });
});
