/**
 * Scenario: each rule here was a Jest case in the app suite reading a source
 * file: a wait drawn as a static glyph, coverage hooks reading around their
 * subscription, a picker opening on a literal period, an insight card sending
 * the athlete to the tab they were on, a hand-rolled header, a label with no
 * bundled glyph stack, a ground token colouring text, and a metrics row
 * written from TypeScript beside the engine's.
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
    'src/app/(tabs)/training.tsx': 'const [r, setR] = useState<TimeRange>(DEFAULT_PERIOD);\n',
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
      'src/app/(tabs)/training.tsx': "const [r, setR] = useState<TimeRange>('3m');\n",
    });

    const { status, output } = runRule('picker-default-period', root);

    expect(status).toBe(1);
    expect(output).toContain("src/app/(tabs)/training.tsx  opens on `'3m'`");
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
    ].join('\n'),
    'src/app/_layout.tsx': [
      '<Stack screenOptions={{ animation: "default" }}>',
      '  <Stack.Screen name="about" />',
      '</Stack>',
    ].join('\n'),
    'src/app/about.tsx': '<View style={styles.container} />\n',
    'src/app/best-efforts/index.tsx': '<View style={styles.container} />\n',
    'src/app/(tabs)/index.tsx': '<View style={styles.header} />\n',
    'src/styles/shared.ts': 'export const shared = { container: {} };\n',
  };

  it('passes screens that take the native header, and a tab that draws its own title row', () => {
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

  it('fails a script that no longer labels anything, so the rule reads nothing', () => {
    const root = fixture({ ...SCRIPTS, 'src/features/maps/lib/htmlBuilders/map3D.ts': '\n' });

    expect(runRule('glyph-stacks', root).output).toContain('has no text-field');
  });
});

describe('ground-token-text', () => {
  const FAMILIES = [
    'export const TOKEN_FAMILIES: Record<string, TokenFamily> = {',
    "  textPrimary: 'text',",
    "  surface: 'ground',",
    "  chartGreen: 'ground',",
    "  primary: 'mark',",
    "  linkTeal: 'text',",
    '};',
  ].join('\n');

  it('fails a mark token in a StyleSheet colour, and passes its text variant', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': FAMILIES,
      'src/features/a/Link.tsx':
        'const s = StyleSheet.create({ link: { color: colors.primary }, ok: { color: colors.linkTeal } });\n',
    });

    const { status, output } = runRule('ground-token-text', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/a/Link.tsx  colours text with colors.primary');
    expect(output).not.toContain('linkTeal');
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

describe('dark-text-counterpart', () => {
  const FAMILIES = [
    'export const TOKEN_FAMILIES: Record<string, TokenFamily> = {',
    "  textPrimary: 'text',",
    "  linkTeal: 'text',",
    "  sameInBoth: 'text',",
    "  surface: 'ground',",
    '};',
  ].join('\n');
  const COLOURS = [
    'export const colors = { linkTeal: "#00796B", sameInBoth: "#111111", surface: "#FFF" };',
    'export const darkColors = { linkTeal: brand.tealDark, sameInBoth: "#111111", surface: "#000" };',
  ].join('\n');

  const theme = {
    'src/theme/tokenFamilies.ts': FAMILIES,
    'src/theme/colors.ts': COLOURS,
  };

  it('fails a file that switches on isDark and draws text in the light value only', () => {
    const root = fixture({
      ...theme,
      'src/features/a/Tabs.tsx': [
        'const s = StyleSheet.create({ active: { color: colors.linkTeal } });',
        'const Tabs = ({ isDark }) => <Text style={[s.active, isDark && s.dark]} />;',
      ].join('\n'),
    });

    const { status, output } = runRule('dark-text-counterpart', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/a/Tabs.tsx  colours text with colors.linkTeal');
  });

  it('passes a file that also reads the dark value of the same token', () => {
    const root = fixture({
      ...theme,
      'src/features/a/Tabs.tsx': [
        'const s = StyleSheet.create({ active: { color: colors.linkTeal } });',
        'const Tabs = ({ isDark }) => <Text style={[s.active, isDark && { color: darkColors.linkTeal }]} />;',
      ].join('\n'),
    });

    expect(runRule('dark-text-counterpart', root).status).toBe(0);
  });

  it('passes a token whose dark value is the same, and a file with no dark branch', () => {
    const root = fixture({
      ...theme,
      'src/features/a/Same.tsx': [
        'const s = StyleSheet.create({ a: { color: colors.sameInBoth } });',
        'const A = ({ isDark }) => <Text style={s.a} />;',
      ].join('\n'),
      'src/features/a/Light.tsx':
        'const s = StyleSheet.create({ a: { color: colors.linkTeal } });\n',
    });

    expect(runRule('dark-text-counterpart', root).status).toBe(0);
  });

  it('reads the real tables', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': real('src/theme/tokenFamilies.ts'),
      'src/theme/colors.ts': real('src/theme/colors.ts'),
      'src/features/a/Tabs.tsx': [
        'const s = StyleSheet.create({ active: { color: colors.linkTeal } });',
        'const Tabs = ({ isDark }) => <Text style={s.active} />;',
      ].join('\n'),
    });

    expect(runRule('dark-text-counterpart', root).status).toBe(1);
  });

  it('fails when the colour tables cannot be read', () => {
    const root = fixture({ 'src/features/a/Tabs.tsx': 'export {};\n' });

    expect(runRule('dark-text-counterpart', root).output).toContain('for this rule to read');
  });
});

describe('metrics-one-writer', () => {
  const FETCHER = 'src/features/routes/hooks/useGpsDataFetcher.ts';
  const STILL_WRITING = { [FETCHER]: 'engine.setActivityMetrics(metrics);\n' };

  it('fails a metrics write from the background insight task', () => {
    const root = fixture({
      ...STILL_WRITING,
      'src/features/insights/backgroundInsightTask.ts': [
        "const { toActivityMetrics } = require('@/shared/activity/activityMetrics');",
        'engine.setActivityMetrics([toActivityMetrics(activity)]);',
      ].join('\n'),
    });

    const { status, output } = runRule('metrics-one-writer', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/insights/backgroundInsightTask.ts:2');
  });

  it('fails a write through the raw binding or a destructured writer', () => {
    const root = fixture({
      ...STILL_WRITING,
      'src/shared/a.ts': 'engine.activities().setMetrics(rows);\n',
      'src/shared/b.ts': 'const { setActivityMetricsExtended } = engine;\n',
    });

    const { output } = runRule('metrics-one-writer', root);

    expect(output).toContain('src/shared/a.ts:1');
    expect(output).toContain('src/shared/b.ts:1');
  });

  it('passes the real background insight task, the listed fetcher and the test tree', () => {
    const root = fixture({
      ...STILL_WRITING,
      'src/features/insights/backgroundInsightTask.ts': real(
        'src/features/insights/backgroundInsightTask.ts'
      ),
      'src/__tests__/fetcher.test.ts': 'engine.setActivityMetrics([]);\n',
      'src/shared/c.ts': '// setActivityMetrics is the engine writer\n',
    });

    expect(runRule('metrics-one-writer', root).status).toBe(0);
  });

  it('fails when a listed writer has stopped writing, so the list only shrinks', () => {
    const root = fixture({ [FETCHER]: 'export {};\n' });

    const { status, output } = runRule('metrics-one-writer', root);

    expect(status).toBe(1);
    expect(output).toContain(`${FETCHER}  is fixed`);
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
    'src/shared/ui/OfflineBanner.tsx',
    'src/features/recording/components/SaveErrorBanner.tsx',
    'src/shared/ui/SyncProgressStrip.tsx',
    'src/features/maps/components/timeline/SyncProgressBanner.tsx',
  ];
  const ok = '<View accessibilityLiveRegion="polite" />;\nuseAnnounceOnAppear(text);\n';
  const all = () => Object.fromEntries(BANNERS.map((f) => [f, ok]));

  it('fails a banner with no live region', () => {
    const root = fixture({ ...all(), [BANNERS[0]]: 'useAnnounceOnAppear(text);\n' });

    const { status, output } = runRule('banner-live-region', root);

    expect(status).toBe(1);
    expect(output).toContain(`${BANNERS[0]}  has no accessibilityLiveRegion`);
  });

  it('fails a banner that never announces on iOS', () => {
    const root = fixture({
      ...all(),
      [BANNERS[1]]: '<View accessibilityLiveRegion="assertive" />;\n',
    });

    expect(runRule('banner-live-region', root).output).toContain('never announces');
  });

  it('passes the real banners', () => {
    const root = fixture(Object.fromEntries(BANNERS.map((f) => [f, real(f)])));

    expect(runRule('banner-live-region', root).status).toBe(0);
  });

  it('fails when a listed banner is gone', () => {
    const { [BANNERS[3]]: _gone, ...rest } = all();

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
