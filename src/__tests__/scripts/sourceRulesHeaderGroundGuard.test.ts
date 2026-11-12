/**
 * Scenario: the rules for the native header, the glyph stacks and the ground token colouring text each fail the shape they name, pass the shape they ask for, and fail when a file they name is gone.
 */

import { fixture, real, removeFixtures, runRule } from '../__shared__/sourceRulesFixture';

afterAll(removeFixtures);

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
    'src/features/maps/components/activityMapLayerSpecs.ts': LABELLED,
    'src/features/maps/components/regional/regionalMapLayerSpecs.ts': LABELLED,
  };

  it('passes a text-field with a text-font beside it', () => {
    expect(runRule('glyph-stacks', fixture(SCRIPTS)).status).toBe(0);
  });

  it('fails a text-field with no text-font', () => {
    const root = fixture({
      ...SCRIPTS,
      'src/features/maps/components/regional/regionalMapLayerSpecs.ts': `${LABELLED}layout: { 'text-field': 'x' }\n`,
    });

    const { status, output } = runRule('glyph-stacks', root);

    expect(status).toBe(1);
    expect(output).toContain('regionalMapLayerSpecs.ts  names 2 text-field and 1 text-font');
  });

  it('passes a script that draws only icons', () => {
    const root = fixture({
      ...SCRIPTS,
      'src/features/maps/components/regional/regionalMapLayerSpecs.ts': '\n',
    });

    expect(runRule('glyph-stacks', root).status).toBe(0);
  });

  it('fails when no script labels anything, so the rule reads nothing', () => {
    const root = fixture({
      'src/features/maps/components/activityMapLayerSpecs.ts': '\n',
      'src/features/maps/components/regional/regionalMapLayerSpecs.ts': '\n',
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
    "  actionPrimary: 'ground',",
    "  actionLink: 'text',",
    '};',
    'export const BRAND_FAMILIES: Record<string, TokenFamily> = {',
    "  blue550: 'mark',",
    "  blue600: 'mark',",
    "  gold: 'mark',",
    '};',
  ].join('\n');

  it('fails a ground token in a StyleSheet colour, and passes its text variant', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': FAMILIES,
      'src/features/a/Link.tsx':
        'const s = StyleSheet.create({ link: { color: colors.actionPrimary }, ok: { color: colors.actionLink } });\n',
    });

    const { status, output } = runRule('ground-token-text', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/a/Link.tsx  colours text with colors.actionPrimary');
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
        '<Text style={{ color: sportMarkColour(sport, isDark) }} />',
      ].join('\n'),
    });

    const { output } = runRule('ground-token-text', root);

    expect(output).toContain('chartColors.green');
    expect(output).toContain('sportMarkColour()');
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

  it('fails a map palette or data ramp hue drawn as text, directly or through a local', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': FAMILIES,
      'src/features/a/Badge.tsx': '<Text style={{ color: sectionPalette[i] }} />\n',
      'src/features/a/Card.tsx': [
        'const numberColor = sectionPalette[slot];',
        '<Text style={[styles.number, { color: numberColor }]} />',
      ].join('\n'),
      'src/features/a/Effort.tsx': [
        'function effortHue(value: number): string {',
        '  return sequentialRamp[Math.floor(value / 2)];',
        '}',
        '<Text style={[styles.value, { color: effortHue(value) }]} />',
      ].join('\n'),
    });

    const { status, output } = runRule('ground-token-text', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/a/Badge.tsx  colours text with sectionPalette[]');
    expect(output).toContain('src/features/a/Card.tsx  colours text with sectionPalette[]');
    expect(output).toContain('src/features/a/Effort.tsx  colours text with sequentialRamp[]');
  });

  it('passes a map palette or data ramp hue drawn as a fill', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': FAMILIES,
      'src/features/a/Card.tsx': [
        'const numberColor = sectionPalette[slot];',
        'function effortHue(value: number): string {',
        '  return sequentialRamp[Math.floor(value / 2)];',
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

  it('fails a brand hue and a sport mark colour drawn as text', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': FAMILIES,
      'src/features/a/Banner.tsx': [
        'const s = StyleSheet.create({ pr: { color: brand.blue600 } });',
        '<Text style={{ color: brand.gold }} />',
        '<Text style={[s.pill, { color: sportMarkColour(group, isDark) }]} />',
      ].join('\n'),
    });

    const { status, output } = runRule('ground-token-text', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/a/Banner.tsx  colours text with brand.blue600');
    expect(output).toContain('src/features/a/Banner.tsx  colours text with brand.gold');
    expect(output).toContain('src/features/a/Banner.tsx  colours text with sportMarkColour()');
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

  it('passes a brand hue as a fill or an icon, a sport mark as an icon, and a themed text token', () => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': FAMILIES,
      'src/features/a/Chip.tsx': [
        'const s = StyleSheet.create({ badge: { backgroundColor: brand.gold, borderColor: brand.blue550 } });',
        '<Icon name="trophy" color={brand.gold} style={s.icon} />',
        '<Icon name="bike" color={sportMarkColour(group, isDark)} />',
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
