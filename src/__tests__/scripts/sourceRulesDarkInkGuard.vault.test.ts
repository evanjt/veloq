/**
 * Scenario: the rules for dark counterparts, dimmed text, disabled-grade ink, the one-writer, one-library, one-back and one-field rules each fail the shape they name, pass the shape they ask for, and fail when a file they name is gone.
 */

import { fixture, real, removeFixtures, runRule } from '../__shared__/sourceRulesFixture';

afterAll(removeFixtures);

describe('dark-counterpart', () => {
  const FAMILIES = [
    'export const TOKEN_FAMILIES: Record<string, TokenFamily> = {',
    "  textPrimary: 'text',",
    "  actionLink: 'text',",
    "  sameInBoth: 'text',",
    "  surface: 'ground',",
    "  surfacePage: 'ground',",
    "  border: 'ground',",
    "  fill: 'mark',",
    '};',
  ].join('\n');
  const COLOURS = [
    'export const colors = { actionLink: "#2F6699", sameInBoth: "#111111", surface: "#FFF", surfacePage: "#FAFAFA", border: "#EEE", fill: "#123456" };',
    'export const darkColors = { actionLink: brand.blueLight, sameInBoth: "#111111", surface: "#000", surfacePage: "#0D0D0D", border: "#222", fill: "#654321" };',
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
        '  row: { backgroundColor: colors.surfacePage, borderBottomColor: colors.border },',
        '});',
        'const Row = ({ isDark }) => <View style={[s.row, isDark && s.dark]} />;',
      ].join('\n'),
    });

    const { status, output } = runRule('dark-counterpart', root);

    expect(status).toBe(1);
    expect(output).toContain('src/features/a/Row.tsx:2  draws colors.surfacePage');
    expect(output).toContain('src/features/a/Row.tsx:2  draws colors.border');
  });

  it('passes a style whose dark sibling sets the same property', () => {
    const root = fixture({
      ...theme,
      'src/features/a/Pill.tsx': [
        'const s = StyleSheet.create({',
        '  pill: { backgroundColor: colors.surfacePage },',
        '  pillDark: { backgroundColor: darkColors.surfaceRaised },',
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
    ['errorText', 'color'],
    ['warningText', 'color'],
    ['surfacePage', 'backgroundColor'],
    ['border', 'borderColor'],
    ['border', 'borderBottomColor'],
  ])('refuses a light-only %s in a file that reads isDark', (token, property) => {
    const root = fixture({
      'src/theme/tokenFamilies.ts': real('src/theme/tokenFamilies.ts'),
      'src/theme/colors.ts': real('src/theme/colors.ts'),
      'src/theme/colourTokens.generated.ts': real('src/theme/colourTokens.generated.ts'),
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
      'src/theme/colourTokens.generated.ts': real('src/theme/colourTokens.generated.ts'),
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
        '  shadow: { color: colors.textOnFill, textShadowColor: colorWithOpacity(ink.black, 0.6) },',
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
      'src/shared/ui/DetailHero.tsx':
        'const s = StyleSheet.create({ statDivider: { color: colors.textPrimary } });\n',
    });

    const { status, output } = runRule('dimmed-text', root);

    expect(status).toBe(1);
    expect(output).toContain('statDivider no longer dims');
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
        'const I = ({ isDark }) => <Icon color={isDark ? darkColors.border : colors.border} />;\n'
      ).status
    ).toBe(1);
  });

  it('passes a line token as a border and a fill, and leaves the test tree alone', () => {
    const root = fixture({
      'src/features/a/Row.tsx': [
        'const s = StyleSheet.create({ row: { borderColor: colors.border, backgroundColor: colors.border } });',
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
