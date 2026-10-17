/**
 * Scenario: the style guards were added one class at a time, so weight, line
 * height, border width, stroke width, icon size, opacity, layer and motion
 * were written by hand at hundreds of sites with no owner and no guard, and
 * nothing noticed a class that had neither.
 *
 * Expected behaviour: each class is a ratchet that refuses a new literal and
 * names the file, a weight of 500 or 800 is refused even inside the theme, and the
 * completeness check fails on a style key that no class places, on a class
 * whose guard is not run and on an owner the theme does not export.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const LITERALS = path.join(REPO, 'scripts/lint-style-literals.mjs');
const OWNERS = path.join(REPO, 'scripts/check-style-owners.mjs');

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-style-owners-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

function run(script: string, args: string[]) {
  try {
    const stdout = execFileSync('node', [script, ...args], { encoding: 'utf8' });
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, output: `${e.stdout}${e.stderr}` };
  }
}

function lintClass(root: string, className: string, baseline: object = {}) {
  const baselineFile = path.join(root, 'baseline.json');
  fs.writeFileSync(baselineFile, JSON.stringify(baseline));
  return run(LITERALS, ['--class', className, '--root', root, '--baseline', baselineFile]);
}

const COMPONENT = 'src/features/garden/PlotCard.tsx';

describe('the style class ratchets', () => {
  it.each([
    ['font-weight', `const s = StyleSheet.create({ label: { fontWeight: '600' } });`],
    ['border-width', 'const s = StyleSheet.create({ edge: { borderWidth: 1 } });'],
    ['icon-size', 'export const A = () => <MaterialCommunityIcons name="leaf" size={22} />;'],
    ['stroke-width', 'export const A = () => <Path d="M0 0" strokeWidth={1.5} />;'],
    ['opacity', 'const s = StyleSheet.create({ faded: { opacity: 0.7 } });'],
    ['z-index', 'const s = StyleSheet.create({ over: { zIndex: 10 } });'],
    ['line-height', 'const s = StyleSheet.create({ body: { lineHeight: 19 } });'],
    ['letter-spacing', 'const s = StyleSheet.create({ caps: { letterSpacing: 0.4 } });'],
    ['font-family', `const s = StyleSheet.create({ mono: { fontFamily: 'Courier' } });`],
    ['font-style', `const s = StyleSheet.create({ aside: { fontStyle: 'italic' } });`],
    ['shadow', 'const s = StyleSheet.create({ lifted: { elevation: 4, shadowRadius: 3 } });'],
    ['alpha', 'const tint = colorWithOpacity(colors.primary, 0.12);'],
    [
      'status-tint',
      'const s = StyleSheet.create({ frost: { backgroundColor: colorWithOpacity(colors.warning, opacity.tint2) } });',
    ],
    ['motion', 'const v = withTiming(1, { duration: 300 });\nconst e = FadeIn.duration(200);'],
    [
      'container',
      'const s = StyleSheet.create({ saveButton: { backgroundColor: colors.primary, borderRadius: layout.borderRadius } });',
    ],
    ['theme-import', "import { colors } from '@/theme/colors';"],
  ])('%s refuses a hand-written value and names its file', (className, source) => {
    const result = lintClass(treeWith({ [COMPONENT]: `${source}\n` }), className);

    expect(result.status).toBe(1);
    expect(result.output).toContain(COMPONENT);
  });

  it.each([
    [
      'a two-digit hex alpha concatenated onto a colour',
      "const s = { a: { backgroundColor: colors.primary + '15' } };",
    ],
    [
      'a two-digit hex alpha templated onto a colour',
      'const s = { a: { backgroundColor: `${c}20` } };',
    ],
  ])('alpha refuses %s', (_shape, source) => {
    const result = lintClass(treeWith({ [COMPONENT]: `${source}\n` }), 'alpha');

    expect(result.status).toBe(1);
    expect(result.output).toContain(COMPONENT);
  });

  it('alpha passes a colour washed at an opacity step and a string joined to a word', () => {
    const source = [
      'const s = { a: { backgroundColor: colorWithOpacity(c, opacity.tint2) } };',
      "const id = 'plot-' + '12';",
      "const label = name + ' 42';",
    ].join('\n');
    const result = lintClass(treeWith({ [COMPONENT]: `${source}\n` }), 'alpha');

    expect(result.status).toBe(0);
  });

  it('passes a file sitting on its baseline and refuses one above it', () => {
    const root = treeWith({
      [COMPONENT]: `const s = StyleSheet.create({ a: { fontWeight: '600' }, b: { fontWeight: '700' } });\n`,
    });

    expect(lintClass(root, 'font-weight', { 'font-weight': { [COMPONENT]: 2 } }).status).toBe(0);
    expect(lintClass(root, 'font-weight', { 'font-weight': { [COMPONENT]: 1 } }).status).toBe(1);
  });

  it('refuses a baseline left above the tree, so a sweep cannot be undone', () => {
    const root = treeWith({ [COMPONENT]: 'export const A = () => null;\n' });
    const result = lintClass(root, 'border-width', { 'border-width': { [COMPONENT]: 3 } });

    expect(result.status).toBe(1);
    expect(result.output).toContain('--write');
  });

  describe('lowered at land', () => {
    const TWO = `const s = StyleSheet.create({ a: { opacity: 0.7 }, b: { opacity: 0.4 } });\n`;
    const OTHER = 'src/features/garden/BedRow.tsx';

    function lower(root: string, className: string, baseline: object) {
      const baselineFile = path.join(root, 'baseline.json');
      fs.writeFileSync(baselineFile, JSON.stringify(baseline));
      const result = run(LITERALS, [
        '--class',
        className,
        '--root',
        root,
        '--baseline',
        baselineFile,
        '--lower',
      ]);
      return { ...result, baseline: JSON.parse(fs.readFileSync(baselineFile, 'utf8')) };
    }

    it('passes a tree below its baseline and writes the baseline down to it', () => {
      const root = treeWith({ [COMPONENT]: TWO, [OTHER]: 'export const B = () => null;\n' });

      const result = lower(root, 'opacity', {
        opacity: { [COMPONENT]: 5, [OTHER]: 2 },
        'z-index': { [OTHER]: 3 },
      });

      expect(result.status).toBe(0);
      expect(result.output).toMatch(/^lowered opacity$/m);
      expect(result.baseline).toEqual({
        opacity: { [COMPONENT]: 2 },
        'z-index': { [OTHER]: 3 },
      });
    });

    it('refuses a tree above its baseline and leaves the baseline as it was', () => {
      const root = treeWith({ [COMPONENT]: TWO, [OTHER]: 'export const B = () => null;\n' });
      const baseline = { opacity: { [COMPONENT]: 1, [OTHER]: 2 } };

      const result = lower(root, 'opacity', baseline);

      expect(result.status).toBe(1);
      expect(result.output).toContain('above the baseline');
      expect(result.output).not.toMatch(/^lowered/m);
      expect(result.baseline).toEqual(baseline);
    });

    it('lowers nothing and says nothing of a tree sitting on its baseline', () => {
      const root = treeWith({ [COMPONENT]: TWO });
      const baseline = { opacity: { [COMPONENT]: 2 } };

      const result = lower(root, 'opacity', baseline);

      expect(result.status).toBe(0);
      expect(result.output).not.toMatch(/^lowered/m);
      expect(result.baseline).toEqual(baseline);
    });

    it('lowers the weight held off the scale with its class, under its own key', () => {
      const root = treeWith({
        [COMPONENT]: `const s = StyleSheet.create({ a: { fontWeight: '600' } });\n`,
      });

      const result = lower(root, 'font-weight', {
        'font-weight': { [COMPONENT]: 1 },
        'font-weight-off-scale': { [COMPONENT]: 1 },
      });

      expect(result.status).toBe(0);
      expect(result.output).toMatch(/^lowered font-weight-off-scale$/m);
      expect(result.output).not.toMatch(/^lowered font-weight$/m);
      expect(result.baseline).toEqual({
        'font-weight': { [COMPONENT]: 1 },
        'font-weight-off-scale': {},
      });
    });

    it('lowers every ratcheted class in one pass, naming the file and each class it lowered', () => {
      const root = treeWith({ [COMPONENT]: TWO });
      const baselineFile = path.join(root, 'baseline.json');
      fs.writeFileSync(
        baselineFile,
        JSON.stringify({ opacity: { [COMPONENT]: 3 }, 'z-index': { [COMPONENT]: 1 } })
      );

      const result = run(path.join(REPO, 'scripts/lower-style-baselines.mjs'), [
        '--root',
        root,
        '--baseline',
        baselineFile,
      ]);

      expect(result.status).toBe(0);
      expect(result.output.trim().split('\n').sort()).toEqual([
        `${baselineFile}\topacity`,
        `${baselineFile}\tz-index`,
      ]);
      expect(JSON.parse(fs.readFileSync(baselineFile, 'utf8'))).toMatchObject({
        opacity: { [COMPONENT]: 2 },
        'z-index': {},
      });
    });
  });

  it('counts every way a status hue is tinted by hand into a ground or an edge', () => {
    const root = treeWith({
      [COMPONENT]: [
        'const FROST = colorWithOpacity(colors.warning, opacity.tint2);',
        'const s = StyleSheet.create({',
        "  a: { backgroundColor: colors.error + '15', borderColor: colors.info + '30' },",
        '  b: { backgroundColor: isDark ? `${palette.warningAmber}20` : FROST },',
        '});',
      ].join('\n'),
    });

    const listed = run(LITERALS, ['--class', 'status-tint', '--root', root, '--list']).output;

    expect(listed.trim().split('\n')).toHaveLength(4);
    expect(lintClass(root, 'status-tint').status).toBe(1);
  });

  it('passes a status ground read from its role and a status hue that is not a ground', () => {
    const root = treeWith({
      [COMPONENT]: [
        'const s = StyleSheet.create({',
        '  a: { backgroundColor: colors.warningBg, borderColor: colorWithOpacity(colors.primary, opacity.tint2) },',
        '  b: { color: colorWithOpacity(colors.error, opacity.tint2) },',
        '});',
        'const pin = { circleColor: colorWithOpacity(colors.error, opacity.tint2) };',
      ].join('\n'),
    });

    expect(lintClass(root, 'status-tint').status).toBe(0);
  });

  it('counts no token read, no zero and no full opacity', () => {
    const root = treeWith({
      [COMPONENT]: [
        'const s = StyleSheet.create({',
        '  a: { fontWeight: typography.body.fontWeight, borderWidth: 0, opacity: 1 },',
        '  b: { opacity: 0, zIndex: 0, borderWidth: stroke.hairline },',
        '});',
        'export const A = () => <MaterialCommunityIcons name="leaf" size={iconSize.md} />;',
        "import { colors } from '@/theme';",
        "import { gardenTheme } from '@/shared/theme/gardenTheme';",
      ].join('\n'),
    });

    for (const className of ['font-weight', 'border-width', 'opacity', 'z-index', 'icon-size']) {
      expect(lintClass(root, className).status).toBe(0);
    }
    expect(lintClass(root, 'theme-import').status).toBe(0);
  });

  it('refuses a border width that is not a stroke read, a hairline or a constant included', () => {
    for (const value of [
      '1',
      'StyleSheet.hairlineWidth',
      'StyleSheet.hairlineWidth * 2',
      'EDGE_WIDTH',
      'selected ? 2 : 0',
      'spacing.xxs',
    ]) {
      const root = treeWith({
        [COMPONENT]: `const s = StyleSheet.create({ edge: { borderBottomWidth: ${value} } });\n`,
      });
      const result = lintClass(root, 'border-width');

      expect({ value, status: result.status }).toEqual({ value, status: 1 });
      expect(result.output).toContain(COMPONENT);
    }
  });

  it('passes a border width read from the stroke token, switched off or handed on', () => {
    const root = treeWith({
      [COMPONENT]: [
        'const s = StyleSheet.create({',
        '  a: { borderWidth: stroke.one, borderTopWidth: stroke.hairline },',
        '  b: { borderWidth: 0, borderLeftWidth: selected ? stroke.two : 0 },',
        '});',
        'export const A = () => <View style={{ borderBottomWidth: stroke.three }} />;',
        'export const B = () => <View style={{ borderWidth: skin.borderWidth }} />;',
      ].join('\n'),
    });

    expect(lintClass(root, 'border-width').status).toBe(0);
  });

  it('counts an elevation only where it is a style, not the climb in a data object', () => {
    const data = treeWith({ [COMPONENT]: 'const ride = { distance: 4200, elevation: 250 };\n' });
    const style = treeWith({
      [COMPONENT]: 'const s = StyleSheet.create({ lifted: { elevation: 4 } });\n',
    });

    expect(lintClass(data, 'shadow').status).toBe(0);
    expect(lintClass(style, 'shadow').status).toBe(1);
  });

  it('counts only italic as a font style', () => {
    const root = treeWith({
      [COMPONENT]: `const s = StyleSheet.create({ plain: { fontStyle: 'normal' } });\n`,
    });

    expect(lintClass(root, 'font-style').status).toBe(0);
  });

  it.each([
    ['a camera move', 'mapRef.current?.setCamera({ zoom: 12 }, 500);'],
    ['a camera fit', 'mapRef.current?.fitBounds(bounds, padding, 400);'],
    ['a config built apart from its timing call', 'const config = { duration: 250, easing };'],
    ['a timing through the reduce motion owner', 'motionTiming(value, { duration: 300 });'],
  ])('counts a hand-written duration in %s', (_name, source) => {
    const result = lintClass(treeWith({ [COMPONENT]: `${source}\n` }), 'motion');

    expect(result.status).toBe(1);
    expect(result.output).toContain(`${COMPONENT}:1`);
  });

  it('counts no duration read from the motion tokens, and no duration in data', () => {
    const root = treeWith({
      [COMPONENT]: [
        'const e = FadeIn.duration(duration.exit);',
        'const v = withTiming(1, { duration: duration.standard, easing: easing.standard });',
        '<Animated.View {...motionPresets.banner} />;',
        'mapRef.current?.setCamera({ zoom: 12 }, cameraMove.move);',
        'mapRef.current?.fitBounds(bounds, padding, cameraMove.brisk);',
        'mapRef.current?.fitBounds(bounds, 40);',
        'const lap = { duration: 3600, distance: 42000 };',
      ].join('\n'),
    });

    expect(lintClass(root, 'motion').status).toBe(0);
  });

  it('judges neither the theme nor the tests, except for a weight of 500', () => {
    const root = treeWith({
      'src/theme/typography.ts': `export const typography = { body: { fontWeight: '400' } };\n`,
      'src/__tests__/plot.test.tsx': `const s = { fontWeight: '600', borderWidth: 1 };\n`,
    });

    expect(lintClass(root, 'font-weight').status).toBe(0);
    expect(lintClass(root, 'border-width').status).toBe(0);
  });

  it('lets the shared ui build the containers it owns', () => {
    const button =
      'const s = StyleSheet.create({ button: { backgroundColor: colors.primary, borderRadius: layout.borderRadius } });\n';

    expect(lintClass(treeWith({ 'src/shared/ui/Button.tsx': button }), 'container').status).toBe(0);
    expect(lintClass(treeWith({ [COMPONENT]: button }), 'container').status).toBe(1);
  });

  it('refuses a weight of 500 inside the theme too, under its own count', () => {
    const root = treeWith({
      'src/theme/typography.ts': `export const typography = { label: { fontWeight: '500' } };\n`,
    });
    const result = lintClass(root, 'font-weight');

    expect(result.status).toBe(1);
    expect(result.output).toContain('font-weight-off-scale');
    expect(result.output).toContain('src/theme/typography.ts');
  });

  it('refuses a weight of 800 in a component, a style prop and an svg attribute', () => {
    const root = treeWith({
      [COMPONENT]: [
        `const s = StyleSheet.create({ yield: { fontWeight: '800' } });`,
        `export const A = () => <Text style={{ fontWeight: 800 }} />;`,
        `export const B = () => <SvgText fontWeight="800" />;`,
        '',
      ].join('\n'),
    });
    const result = lintClass(root, 'font-weight', {
      'font-weight': { [COMPONENT]: 2 },
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain('font-weight-off-scale');
    expect(result.output).toContain(`${COMPONENT}:1`);
    expect(result.output).toContain(`${COMPONENT}:2`);
    expect(result.output).toContain(`${COMPONENT}:3`);
  });

  it('passes the weights the scale draws in', () => {
    const root = treeWith({
      'src/theme/typography.ts': `export const typography = { a: { fontWeight: '400' }, b: { fontWeight: '600' }, c: { fontWeight: 700 } };\n`,
    });

    expect(lintClass(root, 'font-weight').status).toBe(0);
  });
});

/** A fixture holding the repository's own theme index, guard list and ESLint config. */
function ownerTree(component: string, overrides: Record<string, string> = {}) {
  const real = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');
  return treeWith({
    'src/theme/index.ts': real('src/theme/index.ts'),
    'scripts/run-guards.mjs': real('scripts/run-guards.mjs'),
    'eslint.config.js': real('eslint.config.js'),
    [COMPONENT]: component,
    ...overrides,
  });
}

const PLAIN = `const s = StyleSheet.create({
  plot: { flexDirection: 'row', padding: spacing.sm, color: colors.text, zIndex: layers.raised },
});
export const A = () => <View style={{ width: 4, opacity: opacity.dim }} />;
`;

describe('the style owner check', () => {
  it('passes a component setting only placed keys', () => {
    const result = run_(ownerTree(PLAIN));

    expect(result.output).toContain('every style key placed');
    expect(result.status).toBe(0);
  });

  it('fails a style key no class places, naming the key and where it is set', () => {
    const component = `const s = StyleSheet.create({ plot: { outlineWidth: 2 } });\n`;
    const result = run_(ownerTree(component));

    expect(result.status).toBe(1);
    expect(result.output).toContain('outlineWidth');
    expect(result.output).toContain(`${COMPONENT}:1`);
  });

  it('fails a new key written into a style prop as well as a sheet', () => {
    const component = `export const A = () => <View style={[base, { boxShadow: '0 1px 2px black' }]} />;\n`;
    const result = run_(ownerTree(component));

    expect(result.status).toBe(1);
    expect(result.output).toContain('boxShadow');
  });

  it('fails a class whose guard the runner does not run', () => {
    const guards = fs
      .readFileSync(path.join(REPO, 'scripts/run-guards.mjs'), 'utf8')
      .replace("name: 'lint:style-z-index'", "name: 'lint:style-layers-renamed'");
    const result = run_(ownerTree(PLAIN, { 'scripts/run-guards.mjs': guards }));

    expect(result.status).toBe(1);
    expect(result.output).toContain('lint:style-z-index');
  });

  it('fails an owner the theme index does not export', () => {
    const index = fs
      .readFileSync(path.join(REPO, 'src/theme/index.ts'), 'utf8')
      .replace(/export \{ typography \} from '\.\/typography';\n/, '');
    const result = run_(ownerTree(PLAIN, { 'src/theme/index.ts': index }));

    expect(result.status).toBe(1);
    expect(result.output).toContain('exports no typography');
  });

  it('places every class the design language names, in its table', () => {
    const table = run(OWNERS, ['--table', '--root', treeWith({})]).output;

    for (const key of [
      'fontWeight',
      'lineHeight',
      'letterSpacing',
      'fontStyle',
      'borderWidth',
      'strokeWidth',
      'elevation',
      'opacity',
      'zIndex',
      'duration',
    ]) {
      expect(table).toContain(`\`${key}\``);
    }
  });
});

function run_(root: string) {
  return run(OWNERS, ['--root', root]);
}
