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

import { fixture, removeFixtures, runRule } from '../__shared__/sourceRulesFixture';

afterAll(removeFixtures);

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

describe('bare-spinner', () => {
  it("fails react-native's ActivityIndicator outside the two owners, under any name", () => {
    const root = fixture({
      'src/features/kiln/FiringLog.tsx': [
        'import {',
        '  View,',
        '  ActivityIndicator,',
        "} from 'react-native';",
      ].join('\n'),
      'src/shared/ui/KilnBadge.tsx': "import { ActivityIndicator as Busy } from 'react-native';\n",
      'src/app/glaze.tsx': [
        "import * as RN from 'react-native';",
        '<RN.ActivityIndicator size="small" />',
      ].join('\n'),
    });

    const { status, output } = runRule('bare-spinner', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/kiln/FiringLog.tsx:3');
    expect(output).toContain('src/shared/ui/KilnBadge.tsx:1');
    expect(output).toContain('src/app/glaze.tsx:2');
  });

  it('passes Spinner and Button themselves, other react-native imports, and tests', () => {
    const root = fixture({
      'src/shared/ui/Spinner.tsx': "import { ActivityIndicator } from 'react-native';\n",
      'src/shared/ui/Button.tsx': "import { ActivityIndicator, Pressable } from 'react-native';\n",
      'src/features/kiln/FiringLog.tsx': "import { View, Text } from 'react-native';\n",
      'src/__tests__/kiln.test.tsx': "import { ActivityIndicator } from 'react-native';\n",
    });

    expect(runRule('bare-spinner', root).status).toBe(0);
  });
});

describe('bare-refresh-control', () => {
  it("fails react-native's RefreshControl imported outside the shared control, under any name", () => {
    const root = fixture({
      'src/features/kiln/FiringLog.tsx': [
        'import {',
        '  View,',
        '  RefreshControl,',
        "} from 'react-native';",
      ].join('\n'),
      'src/app/kiln.tsx': "import { RefreshControl as Pull } from 'react-native';\n",
      'src/app/glaze.tsx': [
        "import * as RN from 'react-native';",
        '<RN.RefreshControl refreshing={false} />',
      ].join('\n'),
    });

    const { status, output } = runRule('bare-refresh-control', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/kiln/FiringLog.tsx:3');
    expect(output).toContain('src/app/kiln.tsx:1');
    expect(output).toContain('src/app/glaze.tsx:2');
  });

  it('passes the shared control itself, other react-native imports, and tests', () => {
    const root = fixture({
      'src/shared/ui/ScreenRefreshControl.tsx': "import { RefreshControl } from 'react-native';\n",
      'src/features/kiln/FiringLog.tsx': "import { View, ScrollView } from 'react-native';\n",
      'src/__tests__/kiln.test.tsx': "import { RefreshControl } from 'react-native';\n",
    });

    expect(runRule('bare-refresh-control', root).status).toBe(0);
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
      'const [r, setR] = useState<TimeRange>(entryRange ?? FITNESS_DEFAULT_PERIOD);\n',
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
      'src/features/insights/components/StrengthTab.tsx':
        "const [p, setP] = useState<StrengthPeriod>('3m');\n",
    });

    const { status, output } = runRule('picker-default-period', root);

    expect(status).toBe(1);
    expect(output).toContain("src/features/insights/components/StrengthTab.tsx  opens on `'3m'`");
  });

  it('fails a literal fallback behind a handed-in range', () => {
    const root = fixture({
      ...OPENINGS,
      'src/features/fitness/hooks/useFitnessWindow.ts':
        "const [r, setR] = useState<TimeRange>(entryRange ?? '6m');\n",
    });

    expect(runRule('picker-default-period', root).status).toBe(1);
  });

  it('fails the fitness tab opening on the shared default rather than its own', () => {
    const root = fixture({
      ...OPENINGS,
      'src/features/fitness/hooks/useFitnessWindow.ts':
        'const [r, setR] = useState<TimeRange>(entryRange ?? DEFAULT_PERIOD);\n',
    });

    const { status, output } = runRule('picker-default-period', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/fitness/hooks/useFitnessWindow.ts  opens on');
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
