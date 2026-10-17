/**
 * Scenario: each rule here was a Jest case in the app suite reading a source
 * file: a wait drawn as a static glyph, coverage hooks reading around their
 * subscription, a picker opening on a literal period, an insight card sending
 * the athlete to the tab they were on, a hand-rolled header, a label with no
 * bundled glyph stack, a ground token colouring text, disabled-grade ink on
 * live content, and a metrics row written from TypeScript beside the engine's.
 *
 * Expected behaviour: each rule fails the shape it names, passes the shape it
 * asks for, and fails when a file it names is gone.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const ROOT = join(__dirname, '../../..');
const SCRIPT = join(ROOT, 'scripts/lint-source-rules.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'source-rules-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  initFixtureRepo(root);
  return root;
}

function runRule(rule: string, root: string): { status: number; output: string } {
  const args = [SCRIPT, '--rule', rule, '--root', root];
  try {
    const output = execFileSync('node', args, {
      cwd: ROOT,
      encoding: 'utf8',
      env: gitFreeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const real = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('counted-translation', () => {
  it('fails a count joined to a bare translated noun', () => {
    const root = fixture({
      'src/features/routes/Count.tsx': "const label = `${n} ${t('routes.visits')}`;\n",
    });
    expect(runRule('counted-translation', root).status).toBe(1);
  });

  it('passes a count interpolated inside the translation', () => {
    const root = fixture({
      'src/features/routes/Count.tsx': "const label = t('routes.visitsCount', { count: n });\n",
    });
    expect(runRule('counted-translation', root).status).toBe(0);
  });

  it('fails adjacent JSX expressions', () => {
    const root = fixture({
      'src/app/Count.tsx': "<Text>{total} {t('routes.visits')}</Text>\n",
    });
    expect(runRule('counted-translation', root).status).toBe(1);
  });
});

describe('joined-translations', () => {
  it('fails two translations joined by a space', () => {
    const root = fixture({
      'src/features/garden/name.ts':
        "const name = `${t(`garden.season.${season}`)} ${t('garden.plant.fern')}`;\n",
    });
    const { status, output } = runRule('joined-translations', root);
    expect(status).toBe(1);
    expect(output).toContain('src/features/garden/name.ts:1');
  });

  it('fails two translations with nothing between them', () => {
    const root = fixture({
      'src/app/garden.tsx': "const label = `${t('garden.first')}${i18n.t('garden.second')}`;\n",
    });
    expect(runRule('joined-translations', root).status).toBe(1);
  });

  it('passes one phrase carrying its parts as placeholders', () => {
    const root = fixture({
      'src/features/garden/name.ts':
        "const name = t(`garden.name.${season}`, { plant: t('garden.plant.fern') });\n",
    });
    expect(runRule('joined-translations', root).status).toBe(0);
  });

  it('passes a translation beside a value, or two joined by punctuation', () => {
    const root = fixture({
      'src/features/garden/name.ts': [
        "const a = `${t('garden.height')} ${height}`;",
        "const b = `${t('garden.title')}: ${t('garden.status')}`;",
        '',
      ].join('\n'),
    });
    expect(runRule('joined-translations', root).status).toBe(0);
  });

  it('skips the test directories', () => {
    const root = fixture({
      'src/__tests__/garden.test.ts': "const n = `${t('garden.a')} ${t('garden.b')}`;\n",
      'src/features/garden/ok.ts': "export const ok = t('garden.a');\n",
    });
    expect(runRule('joined-translations', root).status).toBe(0);
  });
});

it('refuses a rule it does not know', () => {
  expect(runRule('everything', fixture({ 'src/a.ts': 'export {};\n' })).status).toBe(2);
});

describe('static-loading-glyph', () => {
  it('fails a wait drawn as the static loading glyph', () => {
    const root = fixture({
      'src/features/maps/Pending.tsx': '<MaterialCommunityIcons name="loading" size={16} />\n',
    });

    const { status, output } = runRule('static-loading-glyph', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/maps/Pending.tsx:1');
  });

  it('fails the still download glyph swapped in for an export wait', () => {
    const root = fixture({
      'src/features/maps/Export.tsx': "name={busy ? 'progress-download' : 'download'}\n",
    });

    const { status, output } = runRule('static-loading-glyph', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/maps/Export.tsx:1');
  });

  it('passes a spinner, and leaves the test tree alone', () => {
    const root = fixture({
      'src/features/maps/Pending.tsx': '<ActivityIndicator size="small" />\n',
      'src/__tests__/pending.test.tsx': '<MaterialCommunityIcons name="loading" />\n',
    });

    expect(runRule('static-loading-glyph', root).status).toBe(0);
  });
});

describe('chrome-glyphs', () => {
  it('fails a share or delete glyph drawn on the Material icon outside ChromeIcon', () => {
    const root = fixture({
      'src/features/kiln/Firing.tsx': [
        '<MaterialCommunityIcons name="trash-can-outline" size={16} />',
        '<MaterialCommunityIcons',
        "  name={glazed ? 'undo' : 'delete-outline'}",
        '/>',
        "<MaterialCommunityIcons name={'export-variant' as keyof typeof MaterialCommunityIcons.glyphMap} />",
        '',
      ].join('\n'),
    });

    const { status, output } = runRule('chrome-glyphs', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/kiln/Firing.tsx:1');
    expect(output).toContain('src/features/kiln/Firing.tsx:3');
    expect(output).toContain('src/features/kiln/Firing.tsx:5');
  });

  it('fails a menu entry carrying a share glyph of its own', () => {
    const root = fixture({
      'src/features/kiln/KilnMenu.tsx': "const entry = { key: 'send', icon: 'share-variant' };\n",
    });

    const { status, output } = runRule('chrome-glyphs', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/kiln/KilnMenu.tsx:1');
  });

  it('passes ChromeIcon itself, an action named delete, other glyphs and the test tree', () => {
    const root = fixture({
      'src/shared/ui/ChromeIcon.tsx': "const GLYPHS = { delete: { android: 'delete-outline' } };\n",
      'src/features/kiln/Firing.tsx': [
        "const action = { name: 'delete', label: t('common.delete') };",
        '<MaterialCommunityIcons name="leaf" size={16} />',
        '<ChromeIcon name="delete" size={16} color={ink} />',
        '',
      ].join('\n'),
      'src/__tests__/firing.test.tsx': '<MaterialCommunityIcons name="delete-outline" />\n',
    });

    expect(runRule('chrome-glyphs', root).status).toBe(0);
  });
});

describe('paper-spinner', () => {
  it("fails Paper's ActivityIndicator imported beside its Text, across lines", () => {
    const root = fixture({
      'src/features/kiln/FiringLog.tsx': [
        'import {',
        '  Text,',
        '  ActivityIndicator,',
        "} from 'react-native-paper';",
        '<ActivityIndicator size="small" />',
      ].join('\n'),
    });

    const { status, output } = runRule('paper-spinner', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/kiln/FiringLog.tsx:3');
  });

  it('fails it under another name, and drawn through a namespace import', () => {
    const root = fixture({
      'src/app/kiln.tsx': "import { ActivityIndicator as Busy } from 'react-native-paper';\n",
      'src/features/kiln/Glaze.tsx': [
        "import * as Paper from 'react-native-paper';",
        '<Paper.ActivityIndicator />',
      ].join('\n'),
    });

    const { status, output } = runRule('paper-spinner', root);

    expect(status).toBe(1);
    expect(output).toContain('src/app/kiln.tsx:1');
    expect(output).toContain('src/features/kiln/Glaze.tsx:2');
  });

  it("passes react-native's indicator and Paper's other components, and leaves tests alone", () => {
    const root = fixture({
      'src/shared/ui/Spinner.tsx': "import { ActivityIndicator } from 'react-native';\n",
      'src/features/kiln/FiringLog.tsx':
        "import { Text, ProgressBar } from 'react-native-paper';\n",
      'src/__tests__/kiln.test.tsx': "import { ActivityIndicator } from 'react-native-paper';\n",
    });

    expect(runRule('paper-spinner', root).status).toBe(0);
  });
});

describe('lone-spinner-in-padding', () => {
  const PADDED = [
    "import { View, StyleSheet, ActivityIndicator } from 'react-native';",
    "import { Spinner } from '@/shared/ui';",
    'export function Kiln({ busy }: { busy: boolean }) {',
    '  return busy ? (',
    '    <View style={styles.loadingContainer}>',
    '      <Spinner />',
    '    </View>',
    '  ) : (',
    '    <View style={[styles.waiting]}>',
    '      <ActivityIndicator size="small" />',
    '    </View>',
    '  );',
    '}',
    'const styles = StyleSheet.create({',
    '  loadingContainer: { padding: 24, alignItems: "center" },',
    '  waiting: { paddingVertical: 32, justifyContent: "center" },',
    '});',
  ].join('\n');

  it('fails a spinner that is the only child of a padding-only box', () => {
    const root = fixture({ 'src/features/kiln/Kiln.tsx': PADDED });

    const { status, output } = runRule('lone-spinner-in-padding', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/kiln/Kiln.tsx:5');
    expect(output).toContain('src/features/kiln/Kiln.tsx:9');
  });

  it('passes a box that is sized, a spinner with words beside it, and the test tree', () => {
    const root = fixture({
      'src/features/kiln/Glaze.tsx': [
        "import { View, Text, StyleSheet } from 'react-native';",
        "import { Spinner } from '@/shared/ui';",
        'export function Glaze() {',
        '  return (',
        '    <>',
        '      <View style={styles.centred}>',
        '        <Spinner />',
        '      </View>',
        '      <View style={styles.loadingContainer}>',
        '        <Spinner />',
        '        <Text>Firing</Text>',
        '      </View>',
        '    </>',
        '  );',
        '}',
        'const styles = StyleSheet.create({',
        '  centred: { flex: 1, alignItems: "center" },',
        '  loadingContainer: { padding: 24 },',
        '});',
      ].join('\n'),
      'src/__tests__/kiln.test.tsx': PADDED,
    });

    expect(runRule('lone-spinner-in-padding', root).status).toBe(0);
  });
});

describe('coverage-hooks-read', () => {
  const READS = {
    'src/shared/native/useRangeCoverage.ts':
      'const range = useEngineRead([read], () => read(id));\n',
    'src/shared/native/useLibraryCoverage.ts':
      'const library = useEngineRead([read], () => read());\n',
  };

  it('passes hooks that read through useEngineRead', () => {
    expect(runRule('coverage-hooks-read', fixture(READS)).status).toBe(0);
  });

  it('fails a hook keyed on a subscription trigger', () => {
    const root = fixture({
      ...READS,
      'src/shared/native/useLibraryCoverage.ts': [
        "const trigger = useEngineSubscription(['activities']);",
        'const library = useMemo(() => read(), [trigger]);',
      ].join('\n'),
    });

    const { status, output } = runRule('coverage-hooks-read', root);

    expect(status).toBe(1);
    expect(output).toContain('src/shared/native/useLibraryCoverage.ts:1');
    expect(output).toContain('does not read through useEngineRead');
  });

  it('fails when a hook it names is gone', () => {
    const root = fixture({
      'src/shared/native/useRangeCoverage.ts': READS['src/shared/native/useRangeCoverage.ts'],
    });

    const { status, output } = runRule('coverage-hooks-read', root);

    expect(status).toBe(1);
    expect(output).toContain('src/shared/native/useLibraryCoverage.ts  is named by this rule');
  });
});

describe('picker-default-period', () => {
  const OPENINGS = {
    'src/features/fitness/hooks/useFitnessWindow.ts':
      'const [r, setR] = useState<TimeRange>(entryRange ?? DEFAULT_PERIOD);\n',
    'src/app/(tabs)/training/index.tsx': 'const [r, setR] = useState<TimeRange>(DEFAULT_PERIOD);\n',
    'src/features/routes/hooks/useSectionUIState.ts':
      'const [r, setR] = useState<SectionTimeRange>(DEFAULT_PERIOD);\n',
    'src/features/insights/components/StrengthTab.tsx':
      'const [p, setP] = useState<StrengthPeriod>(DEFAULT_PERIOD);\n',
    'src/app/(tabs)/map.tsx': 'const [p, setP] = useState<MapPeriod>(DEFAULT_MAP_PERIOD);\n',
  };

  it('passes pickers that open on the shared constant', () => {
    expect(runRule('picker-default-period', fixture(OPENINGS)).status).toBe(0);
  });

  it('fails a picker that opens on a literal of its own', () => {
    const root = fixture({
      ...OPENINGS,
      'src/app/(tabs)/training/index.tsx': "const [r, setR] = useState<TimeRange>('3m');\n",
    });

    const { status, output } = runRule('picker-default-period', root);

    expect(status).toBe(1);
    expect(output).toContain("src/app/(tabs)/training/index.tsx  opens on `'3m'`");
  });

  it('fails a literal fallback behind a handed-in range', () => {
    const root = fixture({
      ...OPENINGS,
      'src/features/fitness/hooks/useFitnessWindow.ts':
        "const [r, setR] = useState<TimeRange>(entryRange ?? '6m');\n",
    });

    expect(runRule('picker-default-period', root).status).toBe(1);
  });

  it('fails the map opening on the shared period rather than its own', () => {
    const root = fixture({
      ...OPENINGS,
      'src/app/(tabs)/map.tsx': 'const [p, setP] = useState<MapPeriod>(DEFAULT_PERIOD);\n',
    });

    expect(runRule('picker-default-period', root).output).toContain('src/app/(tabs)/map.tsx');
  });

  it('fails when a picker it names has no period state to read', () => {
    const root = fixture({
      ...OPENINGS,
      'src/features/insights/components/StrengthTab.tsx':
        'export const StrengthTab = () => null;\n',
    });

    expect(runRule('picker-default-period', root).output).toContain('has no period useState');
  });
});

describe('insight-targets', () => {
  it('fails a generator that targets the Insights tab', () => {
    const root = fixture({
      'src/features/insights/generators/periodComparison.ts':
        "return { id: 'x', navigationTarget: '/insights?tab=routes' };\n",
    });

    const { status, output } = runRule('insight-targets', root);

    expect(status).toBe(1);
    expect(output).toContain('periodComparison.ts  targets /insights?tab=routes');
  });

  it('passes a generator that opens the window it is a picture of', () => {
    const root = fixture({
      'src/features/insights/generators/periodComparison.ts':
        "return { id: 'x', navigationTarget: '/fitness?range=1m' };\n",
    });

    expect(runRule('insight-targets', root).status).toBe(0);
  });
});

describe('native-header', () => {
  const CLEAN = {
    'src/shared/app/screenHeaders.ts': [
      'export const SCREEN_HEADERS: Record<string, ScreenHeader | null> = {',
      "  '(tabs)': null,",
      "  about: { titleKey: 'about.title' },",
      "  'best-efforts': { titleKey: 'bestEffortsScreen.title' },",
      '};',
      'export const TAB_HEADERS: Record<string, ScreenHeader | null> = {',
      "  stopwatch: { titleKey: 'stopwatch.title' },",
      '  compass: null,',
      '};',
    ].join('\n'),
    'src/app/_layout.tsx': [
      '<Stack screenOptions={{ animation: "default" }}>',
      '  <Stack.Screen name="about" />',
      '</Stack>',
    ].join('\n'),
    'src/app/about.tsx': '<View style={styles.container} />\n',
    'src/app/best-efforts/index.tsx': '<View style={styles.container} />\n',
    'src/app/(tabs)/compass.tsx': '<View style={styles.header} />\n',
    'src/app/(tabs)/stopwatch/_layout.tsx': 'export default () => <TabStack tab="stopwatch" />;\n',
    'src/app/(tabs)/stopwatch/index.tsx': '<View style={styles.headerActions} />\n',
    'src/styles/shared.ts': 'export const shared = { container: {} };\n',
  };

  it('passes screens that take the native header, and a headerless tab that draws its own row', () => {
    expect(runRule('native-header', fixture(CLEAN)).status).toBe(0);
  });

  it('reads the real header table', () => {
    const root = fixture({
      ...CLEAN,
      'src/shared/app/screenHeaders.ts': real('src/shared/app/screenHeaders.ts'),
      'src/app/about.tsx': '<View style={[styles.header, { gap: 4 }]} />\n',
    });

    expect(runRule('native-header', root).output).toContain('src/app/about.tsx:1');
  });

  it('fails a hand-rolled back button anywhere under src/app', () => {
    const root = fixture({
      ...CLEAN,
      'src/app/(tabs)/index.tsx': '<TouchableOpacity style={styles.backButton} />\n',
    });

    const { status, output } = runRule('native-header', root);

    expect(status).toBe(1);
    expect(output).toContain('src/app/(tabs)/index.tsx:1');
  });

  it('fails a header row on a screen that takes the native one, as a file or an index', () => {
    const root = fixture({
      ...CLEAN,
      'src/app/best-efforts/index.tsx': '<View style={shared.header} />\n',
    });

    expect(runRule('native-header', root).output).toContain('src/app/best-efforts/index.tsx:1');
  });

  it('fails the header turned off for the whole root stack', () => {
    const root = fixture({
      ...CLEAN,
      'src/app/_layout.tsx': [
        '<Stack screenOptions={{ headerShown: false }}>',
        '  <Stack.Screen name="about" />',
        '</Stack>',
      ].join('\n'),
    });

    expect(runRule('native-header', root).output).toContain('whole root stack');
  });

  it('fails the copied header block coming back to the shared styles', () => {
    const root = fixture({
      ...CLEAN,
      'src/styles/shared.ts': 'export const shared = { headerTitle: {} };\n',
    });

    expect(runRule('native-header', root).output).toContain('copied headerTitle: style');
  });

  it('fails a hand-rolled back button under the shared ui and the features', () => {
    for (const file of ['src/shared/ui/Hero.tsx', 'src/features/strength/components/Body.tsx']) {
      const root = fixture({
        ...CLEAN,
        [file]: '<TouchableOpacity style={styles.backButton} />\n',
      });

      const { status, output } = runRule('native-header', root);

      expect(status).toBe(1);
      expect(output).toContain(`${file}:1`);
    }
  });

  it('fails an arrow-left icon button drawn by a screen under src/app', () => {
    const root = fixture({
      ...CLEAN,
      'src/app/about.tsx': '<IconButton icon="arrow-left" onPress={back} />\n',
    });

    expect(runRule('native-header', root).output).toContain('src/app/about.tsx:1');
  });

  it('fails a headered tab root that has no stack of its own', () => {
    const { 'src/app/(tabs)/stopwatch/_layout.tsx': _gone, ...rest } = CLEAN;

    const { status, output } = runRule('native-header', fixture(rest));

    expect(status).toBe(1);
    expect(output).toContain('src/app/(tabs)/stopwatch/_layout.tsx  is missing');
  });

  it('fails a title row drawn on a headered tab root', () => {
    const root = fixture({
      ...CLEAN,
      'src/app/(tabs)/stopwatch/index.tsx': '<Text style={shared.screenTitle} />\n',
    });

    expect(runRule('native-header', root).output).toContain('src/app/(tabs)/stopwatch/index.tsx:1');
  });

  it('fails a header table with no tab table to read', () => {
    const root = fixture({
      ...CLEAN,
      'src/shared/app/screenHeaders.ts':
        "export const SCREEN_HEADERS = { about: { titleKey: 'a' } };\n",
    });

    expect(runRule('native-header', root).output).toContain('has no TAB_HEADERS object');
  });

  it('fails a back glyph drawn under the features and the shared ui', () => {
    for (const [file, line] of [
      ['src/features/garden/components/BedHeader.tsx', '<Icon name="arrow-left" onPress={back} />'],
      ['src/shared/ui/Hero.tsx', "<IconButton icon='chevron-left' onPress={back} />"],
      ['src/features/garden/components/Plot.tsx', '<Icon name="arrow-back" onPress={back} />'],
    ]) {
      const root = fixture({ ...CLEAN, [file]: `${line}\n` });

      const { status, output } = runRule('native-header', root);

      expect(status).toBe(1);
      expect(output).toContain(`${file}:1`);
    }
  });

  it('passes a glyph that points somewhere other than back in a file listed for it', () => {
    const root = fixture({
      ...CLEAN,
      'src/features/routes/components/SectionTrimOverlay.tsx':
        '<MaterialCommunityIcons name="chevron-left" size={16} />\n',
    });

    expect(runRule('native-header', root).status).toBe(0);
  });

  it('fails a back glyph in a listed file that is not the glyph it is listed for', () => {
    const root = fixture({
      ...CLEAN,
      'src/features/routes/components/SectionTrimOverlay.tsx':
        '<MaterialCommunityIcons name="arrow-left" size={24} />\n',
    });

    expect(runRule('native-header', root).output).toContain(
      'src/features/routes/components/SectionTrimOverlay.tsx:1'
    );
  });

  it('fails a header table it cannot read a route out of', () => {
    const root = fixture({
      ...CLEAN,
      'src/shared/app/screenHeaders.ts': "export const SCREEN_HEADERS = { '(tabs)': null };\n",
    });

    expect(runRule('native-header', root).output).toContain('names no route that takes a header');
  });
});

describe('glyph-stacks', () => {
  const LABELLED =
    "layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'] }\n";
  const SCRIPTS = {
    'src/features/maps/components/Map3DWebView.tsx': LABELLED,
    'src/features/maps/lib/htmlBuilders/map3DScripts.ts': LABELLED,
    'src/features/maps/lib/htmlBuilders/map3D.ts': LABELLED,
  };

  it('passes a text-field with a text-font beside it', () => {
    expect(runRule('glyph-stacks', fixture(SCRIPTS)).status).toBe(0);
  });

  it('fails a text-field with no text-font', () => {
    const root = fixture({
      ...SCRIPTS,
      'src/features/maps/lib/htmlBuilders/map3D.ts': `${LABELLED}layout: { 'text-field': 'x' }\n`,
    });

    const { status, output } = runRule('glyph-stacks', root);

    expect(status).toBe(1);
    expect(output).toContain('map3D.ts  names 2 text-field and 1 text-font');
  });

  it('passes a script that draws only icons', () => {
    const root = fixture({ ...SCRIPTS, 'src/features/maps/lib/htmlBuilders/map3D.ts': '\n' });

    expect(runRule('glyph-stacks', root).status).toBe(0);
  });

  it('fails when no script labels anything, so the rule reads nothing', () => {
    const root = fixture({
      'src/features/maps/components/Map3DWebView.tsx': '\n',
      'src/features/maps/lib/htmlBuilders/map3DScripts.ts': '\n',
      'src/features/maps/lib/htmlBuilders/map3D.ts': '\n',
    });

    const { status, output } = runRule('glyph-stacks', root);

    expect(status).toBe(1);
    expect(output).toContain('have no text-field');
  });
});

describe('ground-token-text', () => {
  const FAMILIES = [
    'export const TOKEN_FAMILIES: Record<string, TokenFamily> = {',
    "  textPrimary: 'text',",
    "  surface: 'ground',",
    "  chartGreen: 'ground',",
    "  primary: 'mark',",
    "  actionLink: 'text',",
    '};',
    'export const BRAND_FAMILIES: Record<string, TokenFamily> = {',
    "  blue550: 'mark',",
    "  blue600: 'mark',",
    "  gold: 'mark',",
    '};',
  ].join('\n');

  it('fails a mark token in a StyleSheet colour, and passes its text variant', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': FAMILIES,
      'src/features/a/Link.tsx':
        'const s = StyleSheet.create({ link: { color: colors.primary }, ok: { color: colors.actionLink } });\n',
    });

    const { status, output } = runRule('ground-token-text', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/a/Link.tsx  colours text with colors.primary');
    expect(output).not.toContain('actionLink');
  });

  it('fails a ground token in a StyleSheet colour', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': FAMILIES,
      'src/features/a/Card.tsx':
        'const s = StyleSheet.create({ label: { color: colors.surface } });\n',
    });

    const { status, output } = runRule('ground-token-text', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/a/Card.tsx  colours text with colors.surface');
  });

  it('fails a chart ground and a sport colour in an inline style', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': FAMILIES,
      'src/features/a/Chip.tsx': [
        '<Text style={{ color: chartColors.green }} />',
        '<Text style={{ color: SPORT_COLORS.Cycling }} />',
      ].join('\n'),
    });

    const { output } = runRule('ground-token-text', root);

    expect(output).toContain('chartColors.green');
    expect(output).toContain('SPORT_COLORS.Cycling');
  });

  it('fails a series hue read from a metric config as a text colour across lines', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': FAMILIES,
      'src/features/a/Row.tsx': [
        '<Text',
        '  style={[',
        '    styles.value,',
        '    selected ? { color: metric.color } : null,',
        '  ]}',
        '/>',
      ].join('\n'),
    });

    const { status, output } = runRule('ground-token-text', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/a/Row.tsx  colours text with metric.color');
  });

  it('fails a map palette or effort ramp hue drawn as text, directly or through a local', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': FAMILIES,
      'src/features/a/Badge.tsx': '<Text style={{ color: sectionPalette[i] }} />\n',
      'src/features/a/Card.tsx': [
        'const numberColor = sectionPalette[slot];',
        '<Text style={[styles.number, { color: numberColor }]} />',
      ].join('\n'),
      'src/features/a/Effort.tsx': [
        'function effortHue(value: number): string {',
        '  return rpeRamp[Math.floor(value / 2)];',
        '}',
        '<Text style={[styles.value, { color: effortHue(value) }]} />',
      ].join('\n'),
    });

    const { status, output } = runRule('ground-token-text', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/a/Badge.tsx  colours text with sectionPalette[]');
    expect(output).toContain('src/features/a/Card.tsx  colours text with sectionPalette[]');
    expect(output).toContain('src/features/a/Effort.tsx  colours text with rpeRamp[]');
  });

  it('passes a map palette or effort ramp hue drawn as a fill', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': FAMILIES,
      'src/features/a/Card.tsx': [
        'const numberColor = sectionPalette[slot];',
        'function effortHue(value: number): string {',
        '  return rpeRamp[Math.floor(value / 2)];',
        '}',
        '<View style={[styles.disc, { backgroundColor: numberColor }]} />',
        '<View style={[styles.thumb, { backgroundColor: effortHue(value) }]} />',
      ].join('\n'),
    });

    expect(runRule('ground-token-text', root).status).toBe(0);
  });

  it('passes a text token, a ground as a fill, and a colour field outside a style', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': FAMILIES,
      'src/features/a/Card.tsx': [
        'const s = StyleSheet.create({ label: { color: colors.textPrimary, backgroundColor: colors.surface } });',
        'const dots = [{ color: colors.surface }];',
      ].join('\n'),
    });

    expect(runRule('ground-token-text', root).status).toBe(0);
  });

  it('fails a brand hue, a sport colour and a category colour drawn as text', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': FAMILIES,
      'src/features/a/Banner.tsx': [
        'const s = StyleSheet.create({ pr: { color: brand.blue600 } });',
        '<Text style={{ color: brand.gold }} />',
        '<Text style={{ color: SPORT_COLORS.Ride }} />',
        '<Text style={[s.pill, { color: ACTIVITY_CATEGORIES[group]?.color }]} />',
      ].join('\n'),
    });

    const { status, output } = runRule('ground-token-text', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/a/Banner.tsx  colours text with brand.blue600');
    expect(output).toContain('src/features/a/Banner.tsx  colours text with brand.gold');
    expect(output).toContain('src/features/a/Banner.tsx  colours text with SPORT_COLORS.Ride');
    expect(output).toContain('src/features/a/Banner.tsx  colours text with ACTIVITY_CATEGORIES');
  });

  it('reads both arms of a conditional colour', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': FAMILIES,
      'src/features/a/Row.tsx': [
        '<Text style={[s.row, { color: isSelected ? brand.blue550 : textPrimary }]} />',
        '<Text style={{ color: isDark ? darkColors.textPrimary : colors.chartGreen }} />',
      ].join('\n'),
    });

    const { status, output } = runRule('ground-token-text', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/a/Row.tsx  colours text with brand.blue550');
    expect(output).toContain('src/features/a/Row.tsx  colours text with colors.chartGreen');
    expect(output).not.toContain('textPrimary');
  });

  it('fails a brand key the table does not classify', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': FAMILIES,
      'src/features/a/New.tsx': '<Text style={{ color: brand.blueLight }} />\n',
    });

    expect(runRule('ground-token-text', root).output).toContain(
      'colours text with brand.blueLight'
    );
  });

  it('passes a brand hue as a fill or an icon, a category chip ink, and a themed text token', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': FAMILIES,
      'src/features/a/Chip.tsx': [
        'const s = StyleSheet.create({ badge: { backgroundColor: brand.gold, borderColor: brand.blue550 } });',
        '<Icon name="trophy" color={brand.gold} style={s.icon} />',
        '<Text style={{ color: ACTIVITY_CATEGORIES[group].selectedInk }} />',
        '<Text style={{ color: isDark ? darkColors.actionLink : colors.actionLink }} />',
      ].join('\n'),
    });

    expect(runRule('ground-token-text', root).status).toBe(0);
  });

  it('reads the real brand table', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': real('src/theme/tokenFamilies.ts'),
      'src/features/a/Banner.tsx': '<Text style={{ color: brand.gold }} />\n',
    });

    expect(runRule('ground-token-text', root).output).toContain('colours text with brand.gold');
  });

  it('reads the real family table', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': real('src/theme/tokenFamilies.ts'),
      'src/features/a/Card.tsx':
        'const s = StyleSheet.create({ label: { color: colors.surface } });\n',
    });

    expect(runRule('ground-token-text', root).status).toBe(1);
  });

  it('fails when the family table cannot be read', () => {
    const root = fixture({ 'src/features/a/Card.tsx': 'export {};\n' });

    expect(runRule('ground-token-text', root).output).toContain('has no TOKEN_FAMILIES');
  });
});

describe('dark-counterpart', () => {
  const FAMILIES = [
    'export const TOKEN_FAMILIES: Record<string, TokenFamily> = {',
    "  textPrimary: 'text',",
    "  actionLink: 'text',",
    "  sameInBoth: 'text',",
    "  surface: 'ground',",
    "  background: 'ground',",
    "  border: 'ground',",
    "  fill: 'mark',",
    '};',
  ].join('\n');
  const COLOURS = [
    'export const colors = { actionLink: "#2F6699", sameInBoth: "#111111", surface: "#FFF", background: "#FAFAFA", border: "#EEE", fill: "#123456" };',
    'export const darkColors = { actionLink: brand.blueLight, sameInBoth: "#111111", surface: "#000", background: "#0D0D0D", border: "#222", fill: "#654321" };',
  ].join('\n');

  const theme = {
    'src/theme/tokenFamilies.ts': FAMILIES,
    'src/theme/colors.ts': COLOURS,
  };

  it('fails a file that switches on isDark and draws text in the light value only', () => {
    const root = fixture({
      ...theme,
      'src/features/a/Tabs.tsx': [
        'const s = StyleSheet.create({ active: { color: colors.actionLink } });',
        'const Tabs = ({ isDark }) => <Text style={[s.active, isDark && s.dark]} />;',
      ].join('\n'),
    });

    const { status, output } = runRule('dark-counterpart', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/a/Tabs.tsx:1  draws colors.actionLink');
  });

  it('fails a ground or a border drawn in the light value only', () => {
    const root = fixture({
      ...theme,
      'src/features/a/Row.tsx': [
        'const s = StyleSheet.create({',
        '  row: { backgroundColor: colors.background, borderBottomColor: colors.border },',
        '});',
        'const Row = ({ isDark }) => <View style={[s.row, isDark && s.dark]} />;',
      ].join('\n'),
    });

    const { status, output } = runRule('dark-counterpart', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/a/Row.tsx:2  draws colors.background');
    expect(output).toContain('src/features/a/Row.tsx:2  draws colors.border');
  });

  it('passes a style whose dark sibling sets the same property', () => {
    const root = fixture({
      ...theme,
      'src/features/a/Pill.tsx': [
        'const s = StyleSheet.create({',
        '  pill: { backgroundColor: colors.background },',
        '  pillDark: { backgroundColor: darkColors.surfaceElevated },',
        '});',
        'const Pill = ({ isDark }) => <View style={[s.pill, isDark && s.pillDark]} />;',
      ].join('\n'),
    });

    expect(runRule('dark-counterpart', root).status).toBe(0);
  });

  it('fails a style whose dark sibling sets another property', () => {
    const root = fixture({
      ...theme,
      'src/features/a/Pill.tsx': [
        'const s = StyleSheet.create({',
        '  pill: { backgroundColor: colors.surface, borderColor: colors.border },',
        '  pillDark: { backgroundColor: darkColors.surface },',
        '});',
        'const Pill = ({ isDark }) => <View style={[s.pill, isDark && s.pillDark]} />;',
      ].join('\n'),
    });

    const { status, output } = runRule('dark-counterpart', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/a/Pill.tsx:2  draws colors.border');
  });

  it('leaves a token outside the watched list alone', () => {
    const root = fixture({
      ...theme,
      'src/features/a/Mark.tsx': [
        'const s = StyleSheet.create({ dot: { backgroundColor: colors.fill, borderColor: colors.surface } });',
        'const Mark = ({ isDark }) => <View style={s.dot} />;',
      ].join('\n'),
    });

    expect(runRule('dark-counterpart', root).status).toBe(0);
  });

  it('passes a file that also reads the dark value of the same token', () => {
    const root = fixture({
      ...theme,
      'src/features/a/Tabs.tsx': [
        'const s = StyleSheet.create({ active: { color: colors.actionLink } });',
        'const Tabs = ({ isDark }) => <Text style={[s.active, isDark && { color: darkColors.actionLink }]} />;',
      ].join('\n'),
    });

    expect(runRule('dark-counterpart', root).status).toBe(0);
  });

  it('passes a token whose dark value is the same, and a file with no dark branch', () => {
    const root = fixture({
      ...theme,
      'src/features/a/Same.tsx': [
        'const s = StyleSheet.create({ a: { color: colors.sameInBoth } });',
        'const A = ({ isDark }) => <Text style={s.a} />;',
      ].join('\n'),
      'src/features/a/Light.tsx':
        'const s = StyleSheet.create({ a: { color: colors.actionLink } });\n',
    });

    expect(runRule('dark-counterpart', root).status).toBe(0);
  });

  it.each([
    ['textSecondary', 'color'],
    ['errorDeep', 'color'],
    ['amberIcon', 'color'],
    ['error', 'color'],
    ['background', 'backgroundColor'],
    ['border', 'borderColor'],
    ['divider', 'borderBottomColor'],
  ])('refuses a light-only %s in a file that reads isDark', (token, property) => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': real('src/theme/tokenFamilies.ts'),
      'src/theme/colors.ts': real('src/theme/colors.ts'),
      'src/features/a/Panel.tsx': [
        `const s = StyleSheet.create({ a: { ${property}: colors.${token} } });`,
        'const Panel = ({ isDark }) => <Text style={[s.a, isDark && s.dark]} />;',
      ].join('\n'),
    });

    const { status, output } = runRule('dark-counterpart', root);

    expect(status).toBe(1);
    expect(output).toContain(`src/features/a/Panel.tsx:1  draws colors.${token}`);
  });

  it('reads the real tables', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': real('src/theme/tokenFamilies.ts'),
      'src/theme/colors.ts': real('src/theme/colors.ts'),
      'src/features/a/Tabs.tsx': [
        'const s = StyleSheet.create({ active: { color: colors.actionLink } });',
        'const Tabs = ({ isDark }) => <Text style={s.active} />;',
      ].join('\n'),
    });

    expect(runRule('dark-counterpart', root).status).toBe(1);
  });

  it('fails when the colour tables cannot be read', () => {
    const root = fixture({ 'src/features/a/Tabs.tsx': 'export {};\n' });

    expect(runRule('dark-counterpart', root).output).toContain('for this rule to read');
  });
});

describe('dimmed-text', () => {
  it('fails a style that sets a text colour and an opacity below 1', () => {
    const root = fixture({
      'src/features/a/Note.tsx':
        'const s = StyleSheet.create({ note: { color: colors.textSecondary, opacity: 0.7 } });\n',
    });

    const { status, output } = runRule('dimmed-text', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/a/Note.tsx:1  note');
  });

  it('fails a text colour built at an alpha, in a StyleSheet and inline', () => {
    const root = fixture({
      'src/features/a/Count.tsx': [
        'const s = StyleSheet.create({',
        '  count: { color: colorWithOpacity(ink.white, 0.7) },',
        '});',
        '<Text style={[s.count, { color: colorWithOpacity(colors.textPrimary, 0.6) }]} />',
      ].join('\n'),
    });

    const { status, output } = runRule('dimmed-text', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/a/Count.tsx:2  count');
    expect(output).toContain('src/features/a/Count.tsx:4  (inline)');
  });

  it('passes a full-strength text token, a dimmed fill, and a colour field outside a style', () => {
    const root = fixture({
      'src/features/a/Card.tsx': [
        'const s = StyleSheet.create({',
        '  label: { color: colors.textSecondary },',
        '  wash: { backgroundColor: colorWithOpacity(ink.black, 0.08), opacity: 0.5 },',
        '  shadow: { color: colors.textOnDark, textShadowColor: colorWithOpacity(ink.black, 0.6) },',
        '});',
        'const series = [{ color: colorWithOpacity(colors.textPrimary, 0.4) }];',
      ].join('\n'),
    });

    expect(runRule('dimmed-text', root).status).toBe(0);
  });

  it('passes the text of a disabled control, which WCAG exempts', () => {
    const root = fixture({
      'src/features/a/Row.tsx':
        'const s = StyleSheet.create({ labelDisabled: { color: colors.textPrimary, opacity: 0.4 } });\n',
    });

    expect(runRule('dimmed-text', root).status).toBe(0);
  });

  it('fails a measured entry whose style has stopped dimming, so the measurement cannot go stale', () => {
    const root = fixture({
      'src/shared/ui/OfflineBanner.tsx':
        'const s = StyleSheet.create({ subtitleText: { color: colors.textPrimary } });\n',
    });

    const { status, output } = runRule('dimmed-text', root);

    expect(status).toBe(1);
    expect(output).toContain('subtitleText no longer dims');
  });
});

describe('disabled-ink-content', () => {
  const rule = (body: string) =>
    runRule('disabled-ink-content', fixture({ 'src/features/a/Row.tsx': body }));

  it('fails the disabled ink on a Text with no disabled branch', () => {
    const result = rule('const s = StyleSheet.create({ hint: { color: colors.textDisabled } });\n');

    expect(result.status).toBe(1);
    expect(result.output).toContain('src/features/a/Row.tsx:1');
  });

  it('passes the same ink inside a branch on a disabled state', () => {
    expect(
      rule(
        [
          'const s = StyleSheet.create({ label: { color: colors.textSecondary } });',
          'const Row = ({ disabled }) => (',
          '  <Text style={[s.label, { color: disabled ? colors.textDisabled : colors.textSecondary }]} />',
          ');',
        ].join('\n')
      ).status
    ).toBe(0);
  });

  it('fails the disabled ink on the side of the branch taken when enabled', () => {
    expect(
      rule(
        'const I = ({ disabled }) => <Icon color={disabled ? colors.textSecondary : colors.textDisabled} />;\n'
      ).status
    ).toBe(1);
    expect(
      rule(
        'const I = ({ disabled }) => <Icon color={!disabled ? colors.textDisabled : colors.textSecondary} />;\n'
      ).status
    ).toBe(1);
  });

  it('passes a style keyed on a disabled state and a guard on the disabled flag', () => {
    expect(
      rule(
        [
          'const s = StyleSheet.create({ labelDisabled: { color: colors.textDisabled } });',
          'const Row = ({ isDisabled }) => <Text style={[isDisabled && { color: darkColors.textDisabled }]} />;',
        ].join('\n')
      ).status
    ).toBe(0);
  });

  it('fails a line token drawn as an icon in either theme', () => {
    expect(
      rule(
        'const I = ({ isDark }) => <Icon color={isDark ? darkColors.border : colors.divider} />;\n'
      ).status
    ).toBe(1);
  });

  it('passes a line token as a border and a fill, and leaves the test tree alone', () => {
    const root = fixture({
      'src/features/a/Row.tsx': [
        'const s = StyleSheet.create({ row: { borderColor: colors.border, backgroundColor: colors.divider } });',
        'const series = { color: colors.textDisabled };',
      ].join('\n'),
      'src/features/a/__tests__/Row.test.tsx': '<Icon color={colors.textDisabled} />;\n',
    });

    expect(runRule('disabled-ink-content', root).status).toBe(0);
  });
});

describe('metrics-one-writer', () => {
  it('fails a metrics write from the background insight task', () => {
    const root = fixture({
      'src/features/insights/backgroundInsightTask.ts': [
        'engine.setActivityMetrics([buildRow(activity)]);',
      ].join('\n'),
    });

    const { status, output } = runRule('metrics-one-writer', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/insights/backgroundInsightTask.ts:1');
  });

  it('fails a write through the raw binding or a destructured writer', () => {
    const root = fixture({
      'src/shared/a.ts': 'engine.activities().setMetrics(rows);\n',
      'src/shared/b.ts': 'const { setActivityMetricsExtended } = engine;\n',
    });

    const { output } = runRule('metrics-one-writer', root);

    expect(output).toContain('src/shared/a.ts:1');
    expect(output).toContain('src/shared/b.ts:1');
  });

  it('passes the real background insight task, a comment and the test tree', () => {
    const root = fixture({
      'src/features/insights/backgroundInsightTask.ts': real(
        'src/features/insights/backgroundInsightTask.ts'
      ),
      'src/__tests__/fetcher.test.ts': 'engine.setActivityMetrics([]);\n',
      'src/shared/c.ts': '// setActivityMetrics is the engine writer\n',
    });

    expect(runRule('metrics-one-writer', root).status).toBe(0);
  });
});

describe('one-library-open', () => {
  const OWNER = 'src/shared/storage/routeDbLocation.ts';
  const OWNED = { [OWNER]: 'return engine.initWithPath(dbPath);\n' };

  it('fails an engine open beside the owner', () => {
    const root = fixture({
      ...OWNED,
      'src/app/signIn.tsx': 'if (engine.initWithPath(dbPath)) start();\n',
    });

    const { status, output } = runRule('one-library-open', root);

    expect(status).toBe(1);
    expect(output).toContain('src/app/signIn.tsx:1');
  });

  it('passes the owner, a comment and the test tree', () => {
    const root = fixture({
      ...OWNED,
      'src/shared/a.ts': '// `engine.initWithPath(` is the raw open\n',
      'src/__tests__/a.test.ts': 'client.initWithPath(DB);\n',
    });

    expect(runRule('one-library-open', root).status).toBe(0);
  });

  it('fails when the owner is gone', () => {
    const { status } = runRule('one-library-open', fixture({ 'src/a.ts': 'export {};\n' }));

    expect(status).toBe(1);
  });
});

describe('one-back', () => {
  const OWNER = 'src/shared/app/navigation.ts';
  const OWNED = { [OWNER]: "if (router.canGoBack()) router.back();\nelse router.replace('/');\n" };

  it('fails a bare pop beside the owner, called or passed', () => {
    const root = fixture({
      ...OWNED,
      'src/app/kiln.tsx': 'onDone: () => router.back(),\n',
      'src/features/glaze/Sheet.tsx': '<Sheet onClose={router.back} />\n',
    });

    const { status, output } = runRule('one-back', root);

    expect(status).toBe(1);
    expect(output).toContain('src/app/kiln.tsx:1');
    expect(output).toContain('src/features/glaze/Sheet.tsx:1');
  });

  it('passes the owner, a comment, a caller of goBack and the test tree', () => {
    const root = fixture({
      ...OWNED,
      'src/shared/a.ts': '// `router.back()` on a root screen does nothing\n',
      'src/app/kiln.tsx': 'onDone: () => goBack(),\n',
      'src/__tests__/a.test.ts': 'expect(router.back).toHaveBeenCalled();\n',
    });

    expect(runRule('one-back', root).status).toBe(0);
  });

  it('fails when the owner is gone', () => {
    const { status } = runRule('one-back', fixture({ 'src/a.ts': 'export {};\n' }));

    expect(status).toBe(1);
  });
});

describe('one-text-field', () => {
  const OWNERS = {
    'src/shared/ui/TextField.tsx': "import { TextInput } from 'react-native';\n",
    'src/shared/ui/SearchBar.tsx': "import {\n  Pressable,\n  TextInput,\n} from 'react-native';\n",
  };

  it('fails a form drawing its own input from either library', () => {
    const root = fixture({
      ...OWNERS,
      'src/features/harbour/MooringForm.tsx':
        "import React from 'react';\nimport {\n  View,\n  TextInput,\n} from 'react-native';\n",
      'src/app/berth.tsx': "import { Text, TextInput as Field } from 'react-native-paper';\n",
    });

    const { status, output } = runRule('one-text-field', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/harbour/MooringForm.tsx:2');
    expect(output).toContain('src/app/berth.tsx:1');
  });

  it('passes the two owners, a type-only import and the test tree', () => {
    const root = fixture({
      ...OWNERS,
      'src/features/harbour/useMooring.ts':
        "import { Keyboard, type TextInput } from 'react-native';\nimport type { TextInputProps } from 'react-native';\n",
      'src/__tests__/mooring.test.tsx': "import { TextInput } from 'react-native';\n",
    });

    expect(runRule('one-text-field', root).status).toBe(0);
  });

  it('fails when the field it owns is gone', () => {
    const { status } = runRule('one-text-field', fixture({ 'src/a.ts': 'export {};\n' }));

    expect(status).toBe(1);
  });
});

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
    'src/shared/ui/OfflineBanner.tsx',
    'src/features/recording/components/SaveErrorBanner.tsx',
    'src/shared/ui/SyncProgressStrip.tsx',
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
  const DRAWN = BANNERS[5];
  const STATUS_OWNER = 'src/shared/ui/StatusLine.tsx';
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

  it('passes the real banners and status lines', () => {
    const files = [...BANNERS, ...STATUS, STATUS_OWNER, BOUNDARY];
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
    'src/features/routes/components/SportTypeSelector.tsx',
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
    expect(output).toContain('SportTypeSelector.tsx:1');
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

  it('passes the host in the engine geocoder and fails the same line in any other engine file', () => {
    const line = 'pub const ENDPOINT: &str = "https://nominatim.openstreetmap.org";\n';
    const geocoder = 'modules/veloqrs/rust/veloqrs/src/net/geocode.rs';

    expect(runRule('no-geocoding', fixture({ ...clean, [geocoder]: line })).status).toBe(0);
    for (const elsewhere of [
      'modules/veloqrs/rust/veloqrs/src/net/geocode_cache.rs',
      'modules/veloqrs/rust/veloqrs/src/basemap/fetch.rs',
      'modules/veloqrs/rust/veloqrs/src/net/tests/geocode.rs',
      'src/net/geocode.rs',
    ]) {
      const { status, output } = runRule(
        'no-geocoding',
        fixture({ ...clean, [geocoder]: line, [elsewhere]: line })
      );
      expect(status).toBe(1);
      expect(output).toContain(`${elsewhere}:1`);
      expect(output).not.toContain(`${geocoder}:1`);
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
