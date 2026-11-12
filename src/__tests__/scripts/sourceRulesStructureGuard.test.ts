/**
 * Scenario: the rules for import cycles, accessibility, selected state, invert colours, unused keys, geocoding, large titles and decorative icons each fail the shape they name, pass the shape they ask for, and fail when a file they name is gone.
 */

import { fixture, real, removeFixtures, runRule } from '../__shared__/sourceRulesFixture';

afterAll(removeFixtures);

describe('shared-import-cycles', () => {
  it('fails two shared modules importing each other', () => {
    const root = fixture({
      'src/shared/a.ts': "import { b } from './b';\nexport const a = b;\n",
      'src/shared/b.ts': "import { a } from './a';\nexport const b = a;\n",
    });

    const { status, output } = runRule('shared-import-cycles', root);

    expect(status).toBe(1);
    expect(output).toContain('a.ts');
    expect(output).toContain('b.ts');
  });

  it('fails a cycle closed through an index file in a subdirectory', () => {
    const root = fixture({
      'src/shared/a.ts': "import { b } from './lib';\nexport const a = b;\n",
      'src/shared/lib/index.ts': "import { a } from '../a';\nexport const b = a;\n",
    });

    expect(runRule('shared-import-cycles', root).status).toBe(1);
  });

  it('passes a chain, and ignores a cycle outside src/shared', () => {
    const root = fixture({
      'src/shared/a.ts': "import { b } from './b';\nexport const a = b;\n",
      'src/shared/b.ts': 'export const b = 1;\n',
      'src/features/x.ts': "import { y } from './y';\nexport const x = y;\n",
      'src/features/y.ts': "import { x } from './x';\nexport const y = x;\n",
    });

    expect(runRule('shared-import-cycles', root).status).toBe(0);
  });
});

describe('shared-ui-accessibility', () => {
  const labelled = (n: number) =>
    Array.from(
      { length: n },
      () =>
        '<Pressable accessibilityRole="button" accessibilityLabel="Go" onPress={() => go()}>x</Pressable>'
    ).join('\n');

  it('fails a pressable with no role', () => {
    const root = fixture({
      'src/shared/ui/Chip.tsx': `${labelled(10)}\n<Pressable accessibilityLabel="Go" onPress={() => go()}>x</Pressable>\n`,
    });

    const { status, output } = runRule('shared-ui-accessibility', root);

    expect(status).toBe(1);
    expect(output).toContain('Chip.tsx');
    expect(output).toContain('accessibilityRole');
  });

  it('fails a pressable with no label', () => {
    const root = fixture({
      'src/shared/ui/Chip.tsx': `${labelled(10)}\n<TouchableOpacity accessibilityRole="button">x</TouchableOpacity>\n`,
    });

    const { status, output } = runRule('shared-ui-accessibility', root);

    expect(status).toBe(1);
    expect(output).toContain('accessibilityLabel');
  });

  it('fails a PressTarget with no role or label, since the shared controls render through it', () => {
    const root = fixture({
      'src/shared/ui/Chip.tsx': `${labelled(10)}\n<PressTarget onPress={() => go()}>x</PressTarget>\n`,
    });

    const { status, output } = runRule('shared-ui-accessibility', root);

    expect(status).toBe(1);
    expect(output).toContain('Chip.tsx:11  has no accessibilityRole');
    expect(output).toContain('Chip.tsx:11  has no accessibilityLabel');
  });

  it('passes a pressable that spreads its props, and reads past a > inside a prop', () => {
    const root = fixture({
      'src/shared/ui/Chip.tsx': `${labelled(10)}\n<Pressable {...props}>x</Pressable>\n`,
    });

    expect(runRule('shared-ui-accessibility', root).status).toBe(0);
  });

  it('fails a file with tab pressables and no tablist container', () => {
    const root = fixture({
      'src/shared/ui/Bar.tsx': `${labelled(10)}\n<Pressable accessibilityRole="tab" accessibilityLabel="Feed" onPress={() => go()}>x</Pressable>\n`,
    });

    const { status, output } = runRule('shared-ui-accessibility', root);

    expect(status).toBe(1);
    expect(output).toContain('Bar.tsx');
    expect(output).toContain('tablist');
  });

  it('passes a file whose tab pressables sit in a tablist', () => {
    const root = fixture({
      'src/shared/ui/Bar.tsx': `${labelled(10)}\n<View accessibilityRole="tablist"><Pressable accessibilityRole="tab" accessibilityLabel="Feed" onPress={() => go()}>x</Pressable></View>\n`,
    });

    expect(runRule('shared-ui-accessibility', root).status).toBe(0);
  });

  it('fails a Text carrying onPress with no role, and ignores a Text without one', () => {
    const root = fixture({
      'src/shared/ui/Chip.tsx': `${labelled(10)}\n<Text>plain</Text>\n<Text onPress={retry}>Retry</Text>\n`,
    });

    const { status, output } = runRule('shared-ui-accessibility', root);

    expect(status).toBe(1);
    expect(output).toContain('Chip.tsx:12');
    expect(output).toContain('accessibilityRole');
  });

  it('fails when it finds almost no pressables, so a pass is not an empty run', () => {
    const root = fixture({ 'src/shared/ui/Chip.tsx': `${labelled(2)}\n` });

    expect(runRule('shared-ui-accessibility', root).status).toBe(1);
  });
});

describe('banner-live-region', () => {
  const BANNERS = [
    'src/shared/ui/NoticeBanner.tsx',
    'src/shared/ui/FloatingPill.tsx',
    'src/features/recording/components/SaveErrorBanner.tsx',
    'src/features/maps/components/timeline/SyncProgressBanner.tsx',
    'src/shared/ui/SyncErrorBanner.tsx',
    'src/shared/ui/StartupErrorBanner.tsx',
    'src/shared/ui/TrackFetchNotice.tsx',
    'src/shared/app/EngineInitBanner.tsx',
    'src/shared/app/DemoBanner.tsx',
    'src/features/maps/components/TerrainUnavailableNotice.tsx',
    'src/features/recording/components/StatusSlot.tsx',
    'src/features/recording/components/TimerHeader.tsx',
  ];
  const SHARED = BANNERS[0];
  const DRAWN = BANNERS[4];
  const STATUS_OWNER = 'src/shared/ui/StatusLine.tsx';
  const INLINE_OWNER = 'src/shared/ui/InlineNotice.tsx';
  const STATUS = [
    'src/app/login.tsx',
    'src/app/detection-settings.tsx',
    'src/app/recording/review.tsx',
    'src/features/auth/components/SessionExpiredNotice.tsx',
    'src/features/settings/components/BackupSection.tsx',
    'src/features/settings/components/WebdavConfigForm.tsx',
    'src/features/recording/components/UploadPermissionNotice.tsx',
    'src/shared/ui/EmptyState.tsx',
    'src/shared/ui/ErrorState.tsx',
    'src/shared/ui/BodyNotDownloaded.tsx',
  ];
  const BOUNDARY = 'src/shared/ui/ScreenErrorBoundary.tsx';
  const ok = '<View accessibilityLiveRegion="polite" />;\nuseAnnounceOnAppear(text);\n';
  const status = '<StatusLine tone="error" message={text} />;\n';
  const all = (): Record<string, string> => ({
    ...Object.fromEntries(BANNERS.map((f) => [f, ok])),
    ...Object.fromEntries(STATUS.map((f) => [f, status])),
    [STATUS_OWNER]: ok,
    [INLINE_OWNER]: ok,
    [BOUNDARY]: status,
  });

  it('fails a banner with no live region', () => {
    const root = fixture({ ...all(), [BANNERS[1]]: 'useAnnounceOnAppear(text);\n' });

    const { status: code, output } = runRule('banner-live-region', root);

    expect(code).toBe(1);
    expect(output).toContain(`${BANNERS[1]}  has no accessibilityLiveRegion`);
  });

  it('passes a banner drawn with the shared banner, which speaks for it', () => {
    const root = fixture({ ...all(), [DRAWN]: 'return <NoticeBanner title={title} />;\n' });

    expect(runRule('banner-live-region', root).status).toBe(0);
  });

  it('passes a notice drawn as the shared floating pill, which speaks for it', () => {
    const root = fixture({ ...all(), [DRAWN]: 'return <FloatingPill title={title} />;\n' });

    expect(runRule('banner-live-region', root).status).toBe(0);
  });

  it('fails the shared floating pill when it stops speaking for what it draws', () => {
    const root = fixture({ ...all(), [BANNERS[1]]: 'return <FloatingPill title={title} />;\n' });

    const { status: code, output } = runRule('banner-live-region', root);

    expect(code).toBe(1);
    expect(output).toContain(`${BANNERS[1]}  has no accessibilityLiveRegion`);
  });

  it('fails a banner that draws its own view with neither', () => {
    const root = fixture({ ...all(), [DRAWN]: 'return <View testID="banner" />;\n' });

    const { status: code, output } = runRule('banner-live-region', root);

    expect(code).toBe(1);
    expect(output).toContain(`${DRAWN}  has no accessibilityLiveRegion`);
  });

  it('fails the shared banner when it stops speaking, even though it names itself', () => {
    const root = fixture({
      ...all(),
      [SHARED]: 'export function NoticeBanner() { return <NoticeBanner />; }\n',
    });

    const { status: code, output } = runRule('banner-live-region', root);

    expect(code).toBe(1);
    expect(output).toContain(`${SHARED}  has no accessibilityLiveRegion`);
  });

  it('fails a banner that never announces on iOS', () => {
    const root = fixture({
      ...all(),
      [BANNERS[1]]: '<View accessibilityLiveRegion="assertive" />;\n',
    });

    expect(runRule('banner-live-region', root).output).toContain('never announces');
  });

  it('fails a listed result line drawn outside a StatusLine', () => {
    const root = fixture({ ...all(), [STATUS[4]]: '<Text>{saved}</Text>;\n' });

    const { status: code, output } = runRule('banner-live-region', root);

    expect(code).toBe(1);
    expect(output).toContain(`${STATUS[4]}  shows a status outside a StatusLine`);
  });

  it('fails an error boundary added under src/shared/ui without a StatusLine', () => {
    const added = 'src/shared/ui/OrchardErrorBoundary.tsx';
    const root = fixture({ ...all(), [added]: '<View><Text>{title}</Text></View>;\n' });

    expect(runRule('banner-live-region', root).output).toContain(
      `${added}  shows a status outside a StatusLine`
    );
  });

  it('fails a StatusLine that stops announcing', () => {
    const root = fixture({
      ...all(),
      [STATUS_OWNER]: '<View accessibilityLiveRegion="polite" />;\n',
    });

    expect(runRule('banner-live-region', root).output).toContain(
      `${STATUS_OWNER}  no longer carries both`
    );
  });

  it('passes a result drawn as an inline notice, which speaks for it', () => {
    const root = fixture({
      ...all(),
      [STATUS[4]]: '<InlineNotice tone="error" title={text} />;\n',
    });

    expect(runRule('banner-live-region', root).status).toBe(0);
  });

  it('fails the inline notice when it stops speaking', () => {
    const root = fixture({
      ...all(),
      [INLINE_OWNER]: '<View accessibilityLiveRegion="polite" />;\n',
    });

    expect(runRule('banner-live-region', root).output).toContain(
      `${INLINE_OWNER}  no longer carries both`
    );
  });

  it('passes the real banners and status lines', () => {
    const files = [...BANNERS, ...STATUS, STATUS_OWNER, INLINE_OWNER, BOUNDARY];
    const root = fixture(Object.fromEntries(files.map((f) => [f, real(f)])));

    expect(runRule('banner-live-region', root).status).toBe(0);
  });

  it('fails when a listed banner is gone', () => {
    const { [BANNERS[3]]: _gone, ...rest } = all();

    expect(runRule('banner-live-region', fixture(rest)).status).toBe(1);
  });

  it('fails when a listed status file is gone', () => {
    const { [STATUS[0]]: _gone, ...rest } = all();

    expect(runRule('banner-live-region', fixture(rest)).status).toBe(1);
  });
});

describe('selected-state-accessibility', () => {
  const CHIP = [
    'src/features/activity/components/ChartTypeSelector.tsx',
    'src/features/routes/components/preview/PreviewCentrePicker.tsx',
  ];
  const ok = '<Pressable accessibilityState={{ selected }}>x</Pressable>\n';
  const others = () => Object.fromEntries(CHIP.slice(1).map((f) => [f, ok]));
  it('fails a pressable styled by a selected flag with no accessibilityState', () => {
    const root = fixture({
      [CHIP[0]]:
        '<Pressable accessibilityRole="button" style={[a, isSelected && b]} onPress={() => go()}>x</Pressable>\n',
      ...others(),
    });

    const { status, output } = runRule('selected-state-accessibility', root);

    expect(status).toBe(1);
    expect(output).toContain('ChartTypeSelector.tsx:1');
  });

  it('passes one that sets the state, and one with no flag', () => {
    const root = fixture({
      [CHIP[0]]:
        '<Pressable accessibilityState={{ selected: isSelected }} style={[a, isSelected && b]}>x</Pressable>\n<Pressable style={a}>x</Pressable>\n',
      ...others(),
    });

    expect(runRule('selected-state-accessibility', root).status).toBe(0);
  });

  it('fails when a chip file is gone, so a pass is not an empty run', () => {
    const root = fixture({ [CHIP[0]]: ok });

    expect(runRule('selected-state-accessibility', root).status).toBe(1);
  });
});

describe('invert-colors-opt-out', () => {
  const EXEMPT = 'src/features/maps/components/TerrainSnapshotWebView.tsx';
  const worker = '<View style={hidden}><WebView source={{ html }} /></View>\n';

  it('fails a map WebView and a URI image with no opt-out, naming each line', () => {
    const root = fixture({
      [EXEMPT]: worker,
      'src/features/garden/Plot.tsx':
        '<View style={a}>\n  <WebView source={{ html }} />\n</View>\n',
      'src/features/garden/Gardener.tsx': '<Image source={{ uri: photoUrl }} style={a} />\n',
    });

    const { status, output } = runRule('invert-colors-opt-out', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/garden/Plot.tsx:2');
    expect(output).toContain('src/features/garden/Gardener.tsx:1');
  });

  it('passes an opt-out on the element or on a container around it', () => {
    const root = fixture({
      [EXEMPT]: worker,
      'src/features/garden/Plot.tsx':
        '<View accessibilityIgnoresInvertColors>\n  <Inner>\n    <WebView source={{ html }} />\n  </Inner>\n</View>\n',
      'src/features/garden/Gardener.tsx':
        '<Image accessibilityIgnoresInvertColors source={{ uri: photoUrl }} />\n',
    });

    expect(runRule('invert-colors-opt-out', root).status).toBe(0);
  });

  it('passes a bundled image, which is drawn art rather than a photo', () => {
    const root = fixture({
      [EXEMPT]: worker,
      'src/features/garden/Badge.tsx': "<Image source={require('./badge.png')} />\n",
    });

    expect(runRule('invert-colors-opt-out', root).status).toBe(0);
  });

  it('does not count an opt-out on a sibling', () => {
    const root = fixture({
      [EXEMPT]: worker,
      'src/features/garden/Plot.tsx':
        '<View>\n  <View accessibilityIgnoresInvertColors />\n  <WebView source={{ html }} />\n</View>\n',
    });

    expect(runRule('invert-colors-opt-out', root).status).toBe(1);
  });

  it('fails when the exempt snapshot worker is gone, so the exemption cannot outlive it', () => {
    const root = fixture({
      'src/features/garden/Plot.tsx': '<View accessibilityIgnoresInvertColors />\n',
    });

    const { status, output } = runRule('invert-colors-opt-out', root);

    expect(status).toBe(1);
    expect(output).toContain(EXEMPT);
  });
});

describe('unused-i18n-keys', () => {
  const locale = (keys: unknown) => JSON.stringify(keys);

  it('fails a reference key no source mentions', () => {
    const root = fixture({
      'src/i18n/locales/en-GB.json': locale({ feed: { title: 'Feed', old: 'Old' } }),
      'src/app/feed.tsx': "t('feed.title');\n",
    });

    const { status, output } = runRule('unused-i18n-keys', root);

    expect(status).toBe(1);
    expect(output).toContain('feed.old');
    expect(output).not.toContain('feed.title');
  });

  it('counts a plural form as read when its base key is read', () => {
    const root = fixture({
      'src/i18n/locales/en-GB.json': locale({ feed: { count_one: '1', count_other: 'n' } }),
      'src/app/feed.tsx': "t('feed.count', { count });\n",
    });

    expect(runRule('unused-i18n-keys', root).status).toBe(0);
  });

  it('counts a key under a template prefix, and one named in the closed list', () => {
    const root = fixture({
      'src/i18n/locales/en-GB.json': locale({
        activityTypes: { Ride: 'Ride' },
        navigation: { feed: 'Feed' },
      }),
      'src/app/a.tsx': 'export {};\n',
    });

    expect(runRule('unused-i18n-keys', root).status).toBe(0);
  });

  it('counts a key a prebuild plugin reads for a native target', () => {
    const root = fixture({
      'src/i18n/locales/en-GB.json': locale({ gallery: { name: 'Name' } }),
      'src/plugins/nativeTable.js': "module.exports = [{ path: 'gallery.name' }];\n",
      'src/app/a.tsx': 'export {};\n',
    });

    expect(runRule('unused-i18n-keys', root).status).toBe(0);
  });

  it('does not count a mention in a JavaScript file outside the plugins', () => {
    const root = fixture({
      'src/i18n/locales/en-GB.json': locale({ gallery: { name: 'Name' } }),
      'src/vendor/table.js': "module.exports = [{ path: 'gallery.name' }];\n",
      'src/app/a.tsx': 'export {};\n',
    });

    expect(runRule('unused-i18n-keys', root).status).toBe(1);
  });

  it('does not count a mention in the test tree', () => {
    const root = fixture({
      'src/i18n/locales/en-GB.json': locale({ feed: { old: 'Old' } }),
      'src/__tests__/feed.test.tsx': "t('feed.old');\n",
      'src/app/a.tsx': 'export {};\n',
    });

    expect(runRule('unused-i18n-keys', root).status).toBe(1);
  });

  it('fails when the reference locale is gone', () => {
    expect(runRule('unused-i18n-keys', fixture({ 'src/app/a.tsx': 'export {};\n' })).status).toBe(
      1
    );
  });
});

describe('no-geocoding', () => {
  const clean = { 'src/shared/geo/distance.ts': 'export const d = 1;\n' };

  it.each([
    ['a platform reverse geocode', 'src/a.ts', 'await Location.reverseGeocodeAsync(start);\n'],
    ['a platform forward geocode', 'src/a.tsx', 'const r = await geocodeAsync(name);\n'],
    [
      'a Nominatim fetch',
      'src/shared/geo/places.ts',
      "fetch('https://nominatim.openstreetmap.org/reverse?lat=1&lon=2');\n",
    ],
    ['a Photon fetch', 'src/b.ts', "fetch('https://photon.komoot.io/reverse?lat=1');\n"],
    [
      'an engine HTTP call to a geocoder',
      'modules/veloqrs/rust/veloqrs/src/net/places.rs',
      'let url = "https://nominatim.openstreetmap.org/reverse";\n',
    ],
  ])('fails %s', (_label, file, body) => {
    const { status, output } = runRule('no-geocoding', fixture({ ...clean, [file]: body }));

    expect(status).toBe(1);
    expect(output).toContain(`${file}:1`);
  });

  it('fails a geocoding host in every engine file, the former geocoder included', () => {
    const line = 'pub const ENDPOINT: &str = "https://nominatim.openstreetmap.org";\n';
    for (const file of [
      'modules/veloqrs/rust/veloqrs/src/net/geocode.rs',
      'modules/veloqrs/rust/veloqrs/src/net/place_names.rs',
      'modules/veloqrs/rust/veloqrs/src/basemap/fetch.rs',
    ]) {
      const { status, output } = runRule('no-geocoding', fixture({ ...clean, [file]: line }));
      expect(status).toBe(1);
      expect(output).toContain(`${file}:1`);
    }
  });

  it('fails a geocoding module under src/shared/geo whatever it exports', () => {
    const { status, output } = runRule(
      'no-geocoding',
      fixture({ ...clean, 'src/shared/geo/geocoding.ts': 'export const x = 1;\n' })
    );

    expect(status).toBe(1);
    expect(output).toContain('src/shared/geo/geocoding.ts');
  });

  it('fails an import of the deleted module, namespace form included', () => {
    const { status } = runRule(
      'no-geocoding',
      fixture({ ...clean, 'src/a.ts': "import * as geo from '@/shared/geo/geocoding';\n" })
    );

    expect(status).toBe(1);
  });

  it('passes a comment that names the policy URL, and the test tree', () => {
    const { status } = runRule(
      'no-geocoding',
      fixture({
        ...clean,
        'src/hook.ts':
          '// Geocoding disabled for Nominatim ToS compliance.\n// See: https://operations.osmfoundation.org/policies/nominatim/\n',
        'src/__tests__/probe.test.ts': "fetch('https://nominatim.openstreetmap.org/reverse');\n",
      })
    );

    expect(status).toBe(0);
  });
});

describe('large-title-scroll', () => {
  const headers = (largeTitle: boolean) =>
    [
      'export const SCREEN_HEADERS: Record<string, ScreenHeader | null> = {',
      '  login: null,',
      `  about: { titleKey: 'about.title', largeTitle: ${largeTitle} },`,
      "  'best-efforts': { titleKey: 'bestEffortsScreen.title', largeTitle: true },",
      '};',
    ].join('\n');
  const SCROLL = [
    "import { ScreenScrollView } from '@/shared/ui';",
    'export default () => <ScreenScrollView><View /></ScreenScrollView>;',
  ].join('\n');
  const LIST = [
    "import { screenListInsets } from '@/shared/ui';",
    'export default () => (',
    '  <FlatList data={[]} renderItem={() => <View />} {...screenListInsets} />',
    ');',
  ].join('\n');
  const CLEAN = {
    'src/shared/app/screenHeaders.ts': headers(true),
    'src/app/about.tsx': SCROLL,
    'src/app/best-efforts/index.tsx': LIST,
  };

  it('passes a large-title route that renders ScreenScrollView, or a FlatList with the insets', () => {
    expect(runRule('large-title-scroll', fixture(CLEAN)).status).toBe(0);
  });

  it('fails a large-title route whose file renders a bare ScrollView, and names it', () => {
    const root = fixture({
      ...CLEAN,
      'src/app/about.tsx': 'export default () => <ScrollView><View /></ScrollView>;\n',
    });

    const { status, output } = runRule('large-title-scroll', root);

    expect(status).toBe(1);
    expect(output).toContain('src/app/about.tsx');
  });

  it('fails a FlatList that does not spread the insets', () => {
    const root = fixture({
      ...CLEAN,
      'src/app/best-efforts/index.tsx':
        'export default () => <FlatList data={[]} renderItem={() => <View />} />;\n',
    });

    expect(runRule('large-title-scroll', root).output).toContain('src/app/best-efforts/index.tsx');
  });

  it('does not take a mention in a comment or a string for the component', () => {
    const root = fixture({
      ...CLEAN,
      'src/app/about.tsx': [
        '// <ScreenScrollView> goes here',
        "const note = '<ScreenScrollView>';",
        'export default () => <ScrollView />;',
      ].join('\n'),
    });

    expect(runRule('large-title-scroll', root).status).toBe(1);
  });

  it('leaves a route without the flag alone', () => {
    const root = fixture({
      ...CLEAN,
      'src/shared/app/screenHeaders.ts': headers(false).replace('largeTitle: true', 'x: 1'),
      'src/app/about.tsx': 'export default () => <ScrollView />;\n',
      'src/app/best-efforts/index.tsx': 'export default () => <ScrollView />;\n',
    });

    expect(runRule('large-title-scroll', root).status).toBe(0);
  });

  it('judges a large-title tab root by the screen in its directory', () => {
    const tabs = [
      'export const TAB_HEADERS: Record<string, ScreenHeader | null> = {',
      "  stopwatch: { titleKey: 'stopwatch.title', largeTitle: true },",
      '  compass: null,',
      '};',
    ].join('\n');
    const withTabs = {
      ...CLEAN,
      'src/shared/app/screenHeaders.ts': `${headers(true)}\n${tabs}`,
      'src/app/(tabs)/stopwatch/index.tsx': [
        "import { ScrollView } from 'react-native-gesture-handler';",
        'export default () => <ScrollView {...screenListInsets} />;',
      ].join('\n'),
      'src/app/(tabs)/compass.tsx': 'export default () => <ScrollView />;\n',
    };
    expect(runRule('large-title-scroll', fixture(withTabs)).status).toBe(0);

    const bare = fixture({
      ...withTabs,
      'src/app/(tabs)/stopwatch/index.tsx': 'export default () => <ScrollView />;\n',
    });
    const { status, output } = runRule('large-title-scroll', bare);
    expect(status).toBe(1);
    expect(output).toContain('src/app/(tabs)/stopwatch/index.tsx');
  });

  it('fails a flagged route that has no screen file', () => {
    const { 'src/app/about.tsx': _gone, ...rest } = CLEAN;

    expect(runRule('large-title-scroll', fixture(rest)).output).toContain('about');
  });

  it('fails when the header table is gone', () => {
    const { 'src/shared/app/screenHeaders.ts': _gone, ...rest } = CLEAN;

    expect(runRule('large-title-scroll', fixture(rest)).status).toBe(1);
  });

  describe('a route that re-exports a feature screen', () => {
    const ROUTE = [
      "import { PlainScreen } from '@/features/plain';",
      'export default PlainScreen;',
    ].join('\n');
    const BARREL = [
      "export { default as PlainScreen } from './components/PlainScreen';",
      "export { default as OtherScreen } from './components/OtherScreen';",
    ].join('\n');
    const REEXPORTED = {
      ...CLEAN,
      'src/app/about.tsx': ROUTE,
      'src/features/plain/index.ts': BARREL,
      'src/features/plain/components/PlainScreen.tsx': SCROLL,
      'src/features/plain/components/OtherScreen.tsx': SCROLL,
    };

    it('passes when the screen the route exports renders ScreenScrollView', () => {
      expect(runRule('large-title-scroll', fixture(REEXPORTED)).status).toBe(0);
    });

    it('fails when that screen renders a bare ScrollView, though a sibling in the barrel does not', () => {
      const root = fixture({
        ...REEXPORTED,
        'src/features/plain/components/PlainScreen.tsx':
          'export default () => <ScrollView><View /></ScrollView>;\n',
      });

      const { status, output } = runRule('large-title-scroll', root);

      expect(status).toBe(1);
      expect(output).toContain('src/app/about.tsx');
    });

    it('fails when the export it names cannot be found', () => {
      const root = fixture({ ...REEXPORTED, 'src/features/plain/index.ts': 'export {};\n' });

      expect(runRule('large-title-scroll', root).output).toContain('src/app/about.tsx');
    });
  });
});

describe('decorative-icons', () => {
  it('fails an icon glyph drawn directly outside the shared UI, and names its line', () => {
    const root = fixture({
      'src/features/kennel/Leash.tsx':
        "import { MaterialCommunityIcons } from '@expo/vector-icons';\n" +
        'export const Leash = () => <MaterialCommunityIcons name="dog" size={16} color={c} />;\n',
    });

    const { status, output } = runRule('decorative-icons', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/kennel/Leash.tsx:2');
  });

  it('passes the shared icon, a type read off the icon set and a direct use inside the shared UI', () => {
    const root = fixture({
      'src/features/kennel/Leash.tsx':
        "import type { MaterialCommunityIcons } from '@expo/vector-icons';\n" +
        'type Glyph = keyof typeof MaterialCommunityIcons.glyphMap;\n' +
        'export const Leash = ({ g }: { g: Glyph }) => <Icon name={g} size={16} color={c} />;\n',
      'src/shared/ui/Icon.tsx': 'export const Icon = (p) => <MaterialCommunityIcons {...p} />;\n',
    });

    expect(runRule('decorative-icons', root).status).toBe(0);
  });

  it('ignores tests, which draw the icon set to find it', () => {
    const root = fixture({
      'src/__tests__/leash.test.tsx': 'render(<MaterialCommunityIcons name="dog" />);\n',
    });

    expect(runRule('decorative-icons', root).status).toBe(0);
  });
});
