#!/usr/bin/env node
// Rules about how the source is written, each held once here rather than as a
// Jest case reading a file. `run-guards.mjs` registers every rule as its own
// guard with what it catches, and `--rule <name>` runs one.
//
// Every rule reads the index, not the disk, for the reason
// `lib/indexedSources.mjs` gives. A rule that names particular files fails when
// one of them is gone, so a rename cannot leave it checking nothing.
//
// Usage: node scripts/lint-source-rules.mjs --rule <name> [--root <dir>]

import { posix } from 'node:path';

import ts from 'typescript';

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const root = flag('--root') ?? process.cwd();

const TESTS = /(^|\/)(__tests__|__mocks__)\//;

/** Every line of `text` matching `pattern`, as `file:line  text`. */
function linesMatching(file, text, pattern) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (pattern.test(line)) out.push(`${file}:${i + 1}  ${line.trim()}`);
  });
  return out;
}

/** The object literal a `const <name> ... = { ... }` is initialised with. */
function objectLiteral(text, name) {
  const sf = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = null;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      let init = node.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) found = init;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function propertyName(property) {
  const name = property.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return null;
}

// Files whose WebViews never reach the screen, with the invert opt-out rule
// below giving the reason.
const INVERT_EXEMPT = ['src/features/maps/components/TerrainSnapshotWebView.tsx'];

const INVERT_OPT_OUT = 'accessibilityIgnoresInvertColors';

function jsxAttribute(element, name) {
  return element.attributes.properties.find(
    (attr) => ts.isJsxAttribute(attr) && ts.isIdentifier(attr.name) && attr.name.text === name
  );
}

/** Whether an `Image`'s `source` is an object literal carrying a `uri`. */
function sourcesUri(element) {
  const source = jsxAttribute(element, 'source');
  const expression = source?.initializer?.expression;
  return (
    expression !== undefined &&
    ts.isObjectLiteralExpression(expression) &&
    expression.properties.some((property) => propertyName(property) === 'uri')
  );
}

/**
 * Every `<WebView>`, and every `<Image>` whose source is a URI, that neither
 * carries the invert opt-out nor sits inside an element that does.
 */
function invertUnprotectedSites(file, text) {
  const sf = ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites = [];
  const protectedBy = (node) => {
    for (let at = node; at; at = at.parent) {
      const element = ts.isJsxElement(at) ? at.openingElement : at;
      if (
        (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) &&
        jsxAttribute(element, INVERT_OPT_OUT)
      )
        return true;
    }
    return false;
  };
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      const shown = tag === 'WebView' || (tag === 'Image' && sourcesUri(node));
      if (shown && !protectedBy(node)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        sites.push(`${file}:${line + 1}  <${tag}> inverts under Smart Invert`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

const COLOUR_PROPERTY = /^(?:color|backgroundColor|border\w*Color)$/;

/**
 * Every `<colour property>: colors.<token>` in a file, for a token in `tokens`,
 * that nothing pairs with the dark value. A site is paired when the
 * file reads `darkColors.<token>`, or when it sits in a style `K` and the same
 * object holds a `KDark` that sets the same property, which is how a dark
 * theme swaps one role for another.
 */
function lightOnlySites(text, tokens) {
  const sf = ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites = [];
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      COLOUR_PROPERTY.test(propertyName(node) ?? '') &&
      ts.isPropertyAccessExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'colors' &&
      tokens.includes(node.initializer.name.text)
    ) {
      const token = node.initializer.name.text;
      if (!new RegExp(`darkColors\\.${token}\\b`).test(text) && !hasDarkSibling(node)) {
        sites.push({ token, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

/** Whether the style holding `property` has a `<name>Dark` sibling setting it too. */
function hasDarkSibling(property) {
  const style = property.parent;
  const entry = style?.parent;
  if (!ts.isObjectLiteralExpression(style) || !entry || !ts.isPropertyAssignment(entry)) {
    return false;
  }
  const name = propertyName(entry);
  const sheet = entry.parent;
  if (!name || !ts.isObjectLiteralExpression(sheet)) return false;
  const dark = sheet.properties.find(
    (p) => ts.isPropertyAssignment(p) && propertyName(p) === `${name}Dark`
  );
  return (
    !!dark &&
    ts.isObjectLiteralExpression(dark.initializer) &&
    dark.initializer.properties.some((p) => propertyName(p) === propertyName(property))
  );
}

/**
 * The regions of a file where `color:` means text: every
 * `StyleSheet.create({...})` body, and every line carrying a `style=` prop,
 * which is where an inline override lands. A bare `color:` field in a data
 * object is neither, and those describe fills and dots.
 */
function styleRegions(source) {
  const regions = [];
  let at = source.indexOf('StyleSheet.create(');
  while (at !== -1) {
    let depth = 0;
    let i = source.indexOf('(', at);
    const start = i;
    for (; i < source.length; i++) {
      if (source[i] === '(') depth++;
      if (source[i] === ')' && --depth === 0) break;
    }
    regions.push(source.slice(start, i));
    at = source.indexOf('StyleSheet.create(', i);
  }
  regions.push(...source.split('\n').filter((line) => line.includes('style=')));
  return regions;
}

/**
 * Every way a file reads a fill series member as a `color:` value: indexing
 * the series there, a local holding a member, or a function returning one.
 * Each entry is the pattern for the style value and the series it reaches.
 */
function fillSeriesReads(source) {
  const reads = [];
  const series = FILL_SERIES.join('|');
  for (const name of FILL_SERIES) {
    reads.push([new RegExp(`(?<![A-Za-z])color:\\s*${name}\\[`), name]);
  }
  const holders = [
    new RegExp(`(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(${series})\\[`, 'g'),
    new RegExp(
      `function\\s+([A-Za-z_$][\\w$]*)\\s*\\([^)]*\\)[^{]*\\{[^}]*?return\\s+(${series})\\[`,
      'g'
    ),
    new RegExp(
      `(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*\\([^)]*\\)[^=]*=>\\s*(${series})\\[`,
      'g'
    ),
  ];
  for (const holder of holders) {
    for (const [, local, name] of source.matchAll(holder)) {
      reads.push([new RegExp(`(?<![A-Za-z])color:\\s*${local.replace(/\$/g, '\\$')}\\b`), name]);
    }
  }
  return reads;
}

/** Whether a TSX file renders `<ScreenScrollView>`, or a list spreading `screenListInsets`. */
function rendersInsetScroll(text) {
  const sf = ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = false;
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (tag === 'ScreenScrollView') found = true;
      if (tag === 'FlatList' || tag === 'SectionList' || tag === 'ScrollView') {
        found ||= node.attributes.properties.some(
          (a) =>
            ts.isJsxSpreadAttribute(a) &&
            ts.isIdentifier(a.expression) &&
            a.expression.text === 'screenListInsets'
        );
      }
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** The tracked file a module specifier written in `from` names, or undefined. */
function resolveModule(sources, from, specifier) {
  const base = specifier.startsWith('@/')
    ? `src/${specifier.slice(2)}`
    : specifier.startsWith('.')
      ? posix.join(posix.dirname(from), specifier)
      : null;
  if (base === null) return undefined;
  return [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`].find((f) =>
    sources.has(f)
  );
}

/**
 * The file that defines what `file` exports under `name`, following `export { a as b } from`
 * through barrels. A file that does not re-export the name defines it.
 */
function definingFile(sources, file, name, depth = 0) {
  if (depth > 4) return undefined;
  const sf = ts.createSourceFile(
    file,
    sources.get(file),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  for (const statement of sf.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.moduleSpecifier ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }
    const spec = statement.exportClause.elements.find((e) => e.name.text === name);
    if (!spec) continue;
    const target = resolveModule(sources, file, statement.moduleSpecifier.text);
    return (
      target && definingFile(sources, target, (spec.propertyName ?? spec.name).text, depth + 1)
    );
  }
  return file;
}

/**
 * The file that renders the screen a route file exports by default. A route that renders its own
 * scroll view is its own file; one that is `export default Screen` of an import is the file that
 * import resolves to, through any barrel. Undefined when the chain cannot be followed.
 */
function screenFile(sources, routeFile) {
  const sf = ts.createSourceFile(
    routeFile,
    sources.get(routeFile),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const exported = sf.statements.find(
    (st) => ts.isExportAssignment(st) && !st.isExportEquals && ts.isIdentifier(st.expression)
  )?.expression.text;
  if (!exported) return undefined;
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue;
    const { name, namedBindings } = st.importClause;
    let imported;
    if (name?.text === exported) imported = 'default';
    else if (namedBindings && ts.isNamedImports(namedBindings)) {
      const spec = namedBindings.elements.find((e) => e.name.text === exported);
      if (spec) imported = (spec.propertyName ?? spec.name).text;
    }
    if (!imported) continue;
    const target = resolveModule(sources, routeFile, st.moduleSpecifier.text);
    return target && definingFile(sources, target, imported);
  }
  return undefined;
}

/** The files a rule names, each of which has to be tracked. */
function named(sources, files) {
  const missing = files.filter((file) => !sources.has(file));
  return missing.map((file) => `${file}  is named by this rule and is not tracked`);
}

const COVERAGE_HOOKS = [
  'src/shared/native/useRangeCoverage.ts',
  'src/shared/native/useLibraryCoverage.ts',
];

const PICKER_OPENINGS = {
  'src/features/fitness/hooks/useFitnessWindow.ts': 'DEFAULT_PERIOD',
  'src/app/(tabs)/training/index.tsx': 'DEFAULT_PERIOD',
  'src/features/routes/hooks/useSectionUIState.ts': 'DEFAULT_PERIOD',
  'src/features/insights/components/StrengthTab.tsx': 'DEFAULT_PERIOD',
  'src/app/(tabs)/map.tsx': 'DEFAULT_MAP_PERIOD',
};

// The 3D surfaces build their layers as JavaScript inside a template string,
// so the structural test over the layer specs cannot reach them.
const LAYER_SCRIPTS = [
  'src/features/maps/components/Map3DWebView.tsx',
  'src/features/maps/lib/htmlBuilders/map3DScripts.ts',
  'src/features/maps/lib/htmlBuilders/map3D.ts',
];

/**
 * Ground-token sites that fail and are somebody else's to fix. Every entry is a
 * real failure, not an exemption: the list only ever gets shorter, and an entry
 * that has been fixed fails the rule rather than going quiet.
 */
const GROUND_TEXT_BASELINE = [];

/**
 * The colour series in `colors.ts` read by index. They are drawn as map lines,
 * ramps and thumbs, so a member is held to being told apart from its
 * neighbours and not to any text bar.
 */
const FILL_SERIES = ['sectionPalette', 'routePalette', 'rpeRamp', 'strengthRamp'];

/**
 * Tokens whose light value is read through the static `colors` object and whose
 * dark value differs, so a style that names only the light one is wrong in the
 * dark theme, whether it colours text, fills a view or outlines one.
 */
const DARK_COUNTERPART_TOKENS = [
  'linkTeal',
  'textSecondary',
  'errorDeep',
  'error',
  'amberIcon',
  'background',
  'border',
  'divider',
];

/**
 * Dimmed text that is allowed to be, by file and style key, with the reason:
 * measured on the ground behind it at 4.5:1 or more, or a glyph that is pure
 * decoration, which 1.4.3 exempts. Every other dimmed text fails `dimmed-text`.
 * An entry whose style no longer dims fails too, so the list cannot keep a
 * measurement of something that has since changed.
 */
const DIMMED_TEXT_MEASURED = {
  'src/shared/ui/OfflineBanner.tsx': {
    subtitleText: 'pill ink at 0.8 on the pill fill, 4.90:1',
  },
  'src/shared/ui/DetailHero.tsx': {
    statDivider: 'the dot between two stats, which carries no information of its own',
  },
};

/**
 * TypeScript sites that still write `activity_metrics` and are another item's
 * to remove. Like the ground baseline it only shrinks: an entry that has
 * stopped writing fails the rule rather than going quiet.
 */
const METRICS_WRITE_BASELINE = [];

const DISABLED_INK = /\b(?:colors|darkColors)\.(?:textDisabled|divider|border)\b/;
const NAMES_DISABLED = /disabled/i;

/**
 * The expression a node sets as the colour of text or an icon: a JSX `color`
 * prop, or a `color` field inside a `StyleSheet.create` body or a `style` prop.
 */
function inkValue(node) {
  if (ts.isJsxAttribute(node) && node.name.getText() === 'color') {
    const init = node.initializer;
    return init && ts.isJsxExpression(init) ? init.expression : undefined;
  }
  if (!ts.isPropertyAssignment(node) || propertyName(node) !== 'color') return undefined;
  for (let at = node.parent; at; at = at.parent) {
    if (ts.isJsxAttribute(at)) return at.name.getText() === 'style' ? node.initializer : undefined;
    if (
      ts.isCallExpression(at) &&
      at.expression.getText().replace(/\s/g, '') === 'StyleSheet.create'
    ) {
      return node.initializer;
    }
  }
  return undefined;
}

/** Every `colors.<token>` or `darkColors.<token>` read of a disabled-grade ink in `value`. */
function disabledInkReads(value) {
  const reads = [];
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && DISABLED_INK.test(node.getText())) {
      reads.push(node);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(value);
  return reads;
}

/**
 * Whether a condition holds when something is disabled: true when it names a
 * disabled state, false when it negates one, undefined when it names none.
 */
function disabledPolarity(condition) {
  let negated = false;
  let at = condition;
  while (ts.isParenthesizedExpression(at) || ts.isPrefixUnaryExpression(at)) {
    if (ts.isPrefixUnaryExpression(at)) {
      if (at.operator !== ts.SyntaxKind.ExclamationToken) break;
      negated = !negated;
      at = at.operand;
    } else at = at.expression;
  }
  if (!NAMES_DISABLED.test(at.getText())) return undefined;
  return !negated;
}

/**
 * Whether a read sits on the side of a branch taken for a disabled state, or in
 * a style whose key names one. Walks from the read up to the node that sets it.
 */
function guardedByDisabled(read, setter) {
  let child = read;
  for (let at = read.parent; at; child = at, at = at.parent) {
    if (ts.isConditionalExpression(at) && child !== at.condition) {
      const when = disabledPolarity(at.condition);
      if (when !== undefined && child === (when ? at.whenTrue : at.whenFalse)) return true;
    }
    if (
      ts.isBinaryExpression(at) &&
      at.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      child === at.right &&
      disabledPolarity(at.left) === true
    ) {
      return true;
    }
    if (ts.isPropertyAssignment(at) && at !== setter && NAMES_DISABLED.test(propertyName(at) ?? ''))
      return true;
    if (ts.isJsxAttribute(at) || ts.isCallExpression(at)) return false;
  }
  return false;
}

/**
 * Files that draw a back-pointing glyph for something other than leaving the
 * screen, by the one glyph each may draw. Any other back glyph there still fails.
 */
const NOT_BACK_GLYPHS = {
  // Steps a trim handle one point earlier.
  'src/features/routes/components/SectionTrimOverlay.tsx': 'chevron-left',
  // A labelled pill that returns to the feature tour, not down the stack.
  'src/features/settings/components/whatsNew/TourReturnPill.tsx': 'arrow-left',
};

const REFERENCE_LOCALE = 'src/i18n/locales/en-GB.json';

// Every `t(`prefix.${...}`)` in the app whose appended segment the sweep cannot
// see. A prefix is only listed when the runtime can append a value that is not
// a closed set: an activity type, a sport, a ledger kind. Where the set is
// closed, the exact keys go in DYNAMIC_KEYS instead, so a stale one still
// fails. Widening a prefix to cover a whole subtree is what let 72 orphans sit
// under `settings.` unseen.
const DYNAMIC_PREFIXES = [
  'activityTypes.',
  'feed.groups.',
  'filters.',
  'formZones.',
  'insights.hrvTrend.',
  'insights.sectionChanged.',
  'maps.activityTypes.',
  'recording.autoName.',
  'recording.categories.',
  'recording.fields.',
  'recording.gpsModes.',
  'recording.library.status.',
  'recording.rpeLabels.',
  'sectionHistory.kind_',
  'sensors.kinds.',
  'sensors.status.',
];

// Closed sets, built at runtime from a value the sweep cannot see but whose
// members are enumerable from the source.
const DYNAMIC_KEYS = [
  // `navigation.${item.key}` in BottomTabBar.tsx, over MENU_ITEMS.
  'navigation.feed',
  'navigation.fitness',
  'navigation.map',
  'navigation.insights',
  'navigation.health',
  // `settings.${themePreference}` in settings.tsx.
  'settings.light',
  'settings.dark',
  'settings.system',
  // `settings.${mapPreferences.defaultStyle}` and `settings.terrain3D${mode}`,
  // both in settings.tsx.
  'settings.satellite',
  'settings.terrain3DOff',
  'settings.terrain3DAlways',
];

// The engine's one geocoder, the only file that may name a geocoding host.
const ENGINE_GEOCODER = 'modules/veloqrs/rust/veloqrs/src/net/geocode.rs';

const GEOCODING_HOSTS =
  /nominatim\.openstreetmap\.org|photon\.komoot\.(?:io|de)|geocode\.maps\.co|api\.opencagedata\.com|maps\.googleapis\.com\/maps\/api\/geocode|api\.mapbox\.com\/geocoding|geocoding-api\.open-meteo\.com/;

const GEOCODING_PATTERNS = [
  /\b(?:reverseGeocodeAsync|geocodeAsync)\b/,
  GEOCODING_HOSTS,
  /\bfrom\s+['"][^'"]*geocod[^'"]*['"]/i,
];

// One line each pattern has to flag. A pattern that stops matching its own
// probe has been broken by an edit, and would otherwise pass every file.
const GEOCODING_PROBES = [
  'await Location.reverseGeocodeAsync(start);',
  "fetch('https://nominatim.openstreetmap.org/reverse');",
  "import * as geo from '@/shared/geo/geocoding';",
];

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function leafKeys(obj, prefix = '') {
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value))
      keys.push(...leafKeys(value, full));
    else keys.push(full);
  }
  return keys;
}

const RULES = {
  'counted-translation': {
    pathspec: ['src/features', 'src/app'],
    check(sources) {
      const out = [];
      const adjacentLabels = new Set([
        'units.bpm',
        'units.watts',
        'units.ms',
        'units.seconds',
        'units.metres',
        'units.times',
        'metrics.fatigue',
        'sectionHistory.unavailable',
        'backgroundJobs.progressPercent',
      ]);
      for (const [file, source] of sources) {
        if (!/\.tsx$/.test(file) || TESTS.test(file)) continue;
        source.split('\n').forEach((line, index) => {
          const joins = [
            ...line.matchAll(/\$\{[^}]+\}[\s·]*\$\{t\('([^']+)'/g),
            ...line.matchAll(/\{[^{}]+\}\s+\{t\('([^']+)'/g),
          ];
          if (joins.some((join) => !adjacentLabels.has(join[1]))) {
            out.push(`${file}:${index + 1}  ${line.trim()}`);
          }
        });
      }
      return out;
    },
    fix: 'interpolate the count inside one plural translation',
  },
  // A phrase is translated whole, with its parts as placeholders each locale can
  // reorder. Two translations set side by side keep English word order in every
  // language, and a saved activity read 'Matin Vélo' that way. Two joined by
  // punctuation, a label and its value or two sentences, stay legal.
  'joined-translations': {
    pathspec: ['src'],
    check(sources) {
      const out = [];
      const isT = (node) => {
        if (!ts.isCallExpression(node)) return false;
        const callee = node.expression;
        if (ts.isIdentifier(callee)) return callee.text === 't';
        return ts.isPropertyAccessExpression(callee) && callee.name.text === 't';
      };
      for (const [file, text] of sources) {
        if (!/\.tsx?$/.test(file) || TESTS.test(file)) continue;
        const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
        const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
        const visit = (node) => {
          if (ts.isTemplateExpression(node)) {
            const spans = node.templateSpans;
            for (let i = 0; i + 1 < spans.length; i++) {
              const between = spans[i].literal.text;
              if (isT(spans[i].expression) && isT(spans[i + 1].expression) && !between.trim()) {
                const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
                out.push(`${file}:${line + 1}  ${text.split('\n')[line].trim()}`);
                break;
              }
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(sf);
      }
      return out;
    },
    fix: 'translate the whole phrase as one key with placeholders, so each locale orders its own words',
  },
  // A wait shows motion. The `loading` and `progress-download` glyphs are
  // still, and screens used them as though they turned.
  'static-loading-glyph': {
    pathspec: ['src'],
    check(sources) {
      const out = [];
      for (const [file, text] of sources) {
        if (!/\.tsx$/.test(file) || TESTS.test(file)) continue;
        out.push(...linesMatching(file, text, /name="loading"|progress-download/));
      }
      return out;
    },
    fix: 'draw an ActivityIndicator for a wait; keep a static glyph for a settled state',
  },

  // A wait has one look per platform: react-native's ActivityIndicator, which is
  // the system indicator on iOS and the Material circle on Android. Paper's is a
  // drawn Material arc, so on iOS it is a second spinner beside the system one.
  'paper-spinner': {
    pathspec: ['src'],
    check(sources) {
      const out = [];
      for (const [file, text] of sources) {
        if (!/\.tsx?$/.test(file) || TESTS.test(file)) continue;
        const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
        const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
        const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        for (const statement of sf.statements) {
          if (
            !ts.isImportDeclaration(statement) ||
            statement.moduleSpecifier.text !== 'react-native-paper'
          ) {
            continue;
          }
          const bindings = statement.importClause?.namedBindings;
          if (!bindings) continue;
          if (ts.isNamedImports(bindings)) {
            for (const spec of bindings.elements) {
              if ((spec.propertyName ?? spec.name).text === 'ActivityIndicator')
                out.push(`${file}:${at(spec)}  imports ActivityIndicator from react-native-paper`);
            }
          } else if (ts.isNamespaceImport(bindings)) {
            const namespace = bindings.name.text;
            const visit = (node) => {
              if (
                ts.isPropertyAccessExpression(node) &&
                ts.isIdentifier(node.expression) &&
                node.expression.text === namespace &&
                node.name.text === 'ActivityIndicator'
              ) {
                out.push(`${file}:${at(node)}  draws ${namespace}.ActivityIndicator`);
              }
              ts.forEachChild(node, visit);
            };
            visit(sf);
          }
        }
      }
      return out;
    },
    fix: "draw the Spinner from '@/shared/ui', which is the platform's own indicator",
  },

  // The coverage hooks key their read on the reader the body calls. A
  // subscription trigger beside a separately memoised read went stale.
  'coverage-hooks-read': {
    pathspec: COVERAGE_HOOKS,
    check(sources) {
      const out = named(sources, COVERAGE_HOOKS);
      for (const file of COVERAGE_HOOKS) {
        const text = sources.get(file);
        if (text === undefined) continue;
        if (!text.includes('useEngineRead(['))
          out.push(`${file}  does not read through useEngineRead`);
        out.push(...linesMatching(file, text, /useEngineSubscription\(\[/));
      }
      return out;
    },
    fix: 'read through useEngineRead with the reader as the dependency, not a subscription trigger',
  },

  // Every picker opens on the shared period, and the map on its own. A literal
  // in any one of them is how the four drifted apart.
  'picker-default-period': {
    pathspec: Object.keys(PICKER_OPENINGS),
    check(sources) {
      const out = named(sources, Object.keys(PICKER_OPENINGS));
      for (const [file, constant] of Object.entries(PICKER_OPENINGS)) {
        const text = sources.get(file);
        if (text === undefined) continue;
        const initialiser = text.match(
          /useState<(?:TimeRange|SectionTimeRange|StrengthPeriod|MapPeriod)>\(([^)]*)\)/
        );
        if (!initialiser) {
          out.push(`${file}  has no period useState for this rule to read`);
          continue;
        }
        // A screen may open on something a link handed it, `entryRange ??
        // DEFAULT_PERIOD` on the fitness tab, but the fallback is the constant.
        const expression = initialiser[1].trim();
        if (!expression.endsWith(constant) || /['"`]/.test(expression)) {
          out.push(`${file}  opens on \`${expression}\`, not on ${constant}`);
        }
      }
      return out;
    },
    fix: 'open the picker on the shared constant, falling back to it after any handed-in range',
  },

  // The insight sheet is opened from the Insights tab, so a card targeting the
  // tab closes the sheet and lands where the athlete already was.
  'insight-targets': {
    pathspec: ['src/features/insights/generators'],
    check(sources) {
      const out = [];
      for (const [file, text] of sources) {
        if (!/\.ts$/.test(file)) continue;
        for (const [, target] of text.matchAll(/navigationTarget:\s*'([^']*)'/g)) {
          if (target.startsWith('/insights')) out.push(`${file}  targets ${target}`);
        }
      }
      return out;
    },
    fix: 'send the card to the thing it is a picture of',
  },

  // The navigation chrome is the platform's, declared once per route in
  // `screenHeaders`, and no screen draws a back button or header row of its own.
  'native-header': {
    pathspec: ['src/app', 'src/shared', 'src/features', 'src/styles/shared.ts'],
    check(sources) {
      const out = named(sources, [
        'src/app/_layout.tsx',
        'src/shared/app/screenHeaders.ts',
        'src/styles/shared.ts',
      ]);
      for (const [file, text] of sources) {
        if (!/\.tsx?$/.test(file)) continue;
        out.push(...linesMatching(file, text, /\bbackButton\b/));
        text.split('\n').forEach((line, i) => {
          const glyph = line.match(/(?:icon|name)=\{?["'](arrow-left|chevron-left|arrow-back)["']/);
          if (glyph && NOT_BACK_GLYPHS[file] !== glyph[1]) {
            out.push(`${file}:${i + 1}  ${line.trim()}`);
          }
        });
      }

      const headers = objectLiteral(
        sources.get('src/shared/app/screenHeaders.ts') ?? '',
        'SCREEN_HEADERS'
      );
      if (!headers && sources.has('src/shared/app/screenHeaders.ts')) {
        out.push(
          'src/shared/app/screenHeaders.ts  has no SCREEN_HEADERS object for this rule to read'
        );
      }
      // The login screen and the map tab take no header, so the ban on a
      // hand-rolled title row does not reach them.
      const headered = (headers?.properties ?? [])
        .filter(
          (p) => ts.isPropertyAssignment(p) && p.initializer.kind !== ts.SyntaxKind.NullKeyword
        )
        .map(propertyName)
        .filter(Boolean);
      if (headers && headered.length === 0) {
        out.push('src/shared/app/screenHeaders.ts  names no route that takes a header');
      }
      for (const route of headered) {
        const file = [`src/app/${route}.tsx`, `src/app/${route}/index.tsx`].find((f) =>
          sources.has(f)
        );
        if (!file) continue;
        out.push(
          ...linesMatching(file, sources.get(file), /style=\{(?:\[)?(?:styles|shared)\.header\b/)
        );
      }

      // A headered tab root is a stack of one screen, so its header is the
      // platform's: the tab needs its own stack layout and draws no title row.
      const tabHeaders = objectLiteral(
        sources.get('src/shared/app/screenHeaders.ts') ?? '',
        'TAB_HEADERS'
      );
      if (!tabHeaders && sources.has('src/shared/app/screenHeaders.ts')) {
        out.push(
          'src/shared/app/screenHeaders.ts  has no TAB_HEADERS object for this rule to read'
        );
      }
      const headeredTabs = (tabHeaders?.properties ?? [])
        .filter(
          (p) => ts.isPropertyAssignment(p) && p.initializer.kind !== ts.SyntaxKind.NullKeyword
        )
        .map(propertyName)
        .filter(Boolean);
      for (const tab of headeredTabs) {
        const layoutFile = `src/app/(tabs)/${tab}/_layout.tsx`;
        if (!sources.has(layoutFile)) {
          out.push(`${layoutFile}  is missing, so the ${tab} tab has no native header`);
        }
        const file = `src/app/(tabs)/${tab}/index.tsx`;
        if (!sources.has(file)) continue;
        out.push(
          ...linesMatching(
            file,
            sources.get(file),
            /style=\{(?:\[)?(?:styles|shared)\.(?:header|headerTitle|screenTitle)\b/
          )
        );
      }

      const layout = sources.get('src/app/_layout.tsx') ?? '';
      const screenOptions = layout.slice(layout.indexOf('<Stack'), layout.indexOf('<Stack.Screen'));
      if (/headerShown:\s*false/.test(screenOptions)) {
        out.push('src/app/_layout.tsx  turns the header off for the whole root stack');
      }

      const shared = sources.get('src/styles/shared.ts') ?? '';
      for (const key of ['header:', 'headerTitle:', 'backButton:', 'screenTitle:']) {
        if (shared.includes(key)) out.push(`src/styles/shared.ts  carries the copied ${key} style`);
      }
      return out;
    },
    fix: 'declare the header in SCREEN_HEADERS and let the native stack draw it',
  },

  // A collapsing large title only works when the screen's scroll view lets the system inset its
  // content. `ScreenScrollView` sets that on iOS and `screenListInsets` carries it onto a list or a
  // scroll view of another kind, so a route or tab root that takes a large title renders one of them. The tags are read from the syntax tree, so
  // a mention in a comment or a string does not count. A route that only re-exports a feature's
  // screen is judged by the file that defines that screen.
  'large-title-scroll': {
    pathspec: ['src/app', 'src/features', 'src/shared/app/screenHeaders.ts'],
    check(sources) {
      const headersFile = 'src/shared/app/screenHeaders.ts';
      const out = named(sources, [headersFile]);
      const headers = objectLiteral(sources.get(headersFile) ?? '', 'SCREEN_HEADERS');
      if (!headers) {
        if (sources.has(headersFile)) {
          out.push(`${headersFile}  has no SCREEN_HEADERS object for this rule to read`);
        }
        return out;
      }
      const largeTitled = (table) =>
        (table?.properties ?? [])
          .filter((p) => ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.initializer))
          .filter((p) =>
            p.initializer.properties.some(
              (q) =>
                ts.isPropertyAssignment(q) &&
                propertyName(q) === 'largeTitle' &&
                q.initializer.kind === ts.SyntaxKind.TrueKeyword
            )
          )
          .map(propertyName)
          .filter(Boolean);
      // A tab root's screen sits in its tab's directory, under the stack that gives it the header.
      const tabs = objectLiteral(sources.get(headersFile) ?? '', 'TAB_HEADERS');
      const flagged = [...largeTitled(headers), ...largeTitled(tabs).map((tab) => `(tabs)/${tab}`)];
      for (const route of flagged) {
        const file = [`src/app/${route}.tsx`, `src/app/${route}/index.tsx`].find((f) =>
          sources.has(f)
        );
        if (!file) {
          out.push(`${headersFile}  sets largeTitle on ${route}, which has no screen file`);
          continue;
        }
        const screen = rendersInsetScroll(sources.get(file)) ? file : screenFile(sources, file);
        if (!screen || !rendersInsetScroll(sources.get(screen))) {
          out.push(
            `${file}  is a large-title route and renders neither ScreenScrollView nor a list or scroll view spreading screenListInsets`
          );
        }
      }
      return out;
    },
    fix: 'render ScreenScrollView from @/shared/ui, or spread screenListInsets onto the FlatList or ScrollView',
  },

  // A label with no `text-font` takes the style spec's default stack, which the
  // app does not carry, so its glyphs cost a bridge round trip and a 404.
  'glyph-stacks': {
    pathspec: LAYER_SCRIPTS,
    check(sources) {
      const out = named(sources, LAYER_SCRIPTS);
      let labelled = 0;
      for (const file of LAYER_SCRIPTS) {
        const text = sources.get(file);
        if (text === undefined) continue;
        const fields = text.split("'text-field'").length - 1;
        const fonts = text.split("'text-font'").length - 1;
        labelled += fields;
        if (fonts !== fields) {
          out.push(`${file}  names ${fields} text-field and ${fonts} text-font`);
        }
      }
      // A script may draw only icons, but a set with no label at all means the
      // labels moved somewhere this rule does not read.
      if (labelled === 0)
        out.push(`${LAYER_SCRIPTS.join(', ')}  have no text-field for this rule to read`);
      return out;
    },
    fix: "give every 'text-field' a 'text-font' from BUNDLED_GLYPH_STACKS in the same layout",
  },

  // A ground or a mark is not a text token because it answers to a lower bar
  // than text does. `color:` is the text property, so one there is a hue that
  // is held to less than 4.5:1 and drawn as a word. Every arm of a conditional
  // is read, since a selected row drawn in a fill is as wrong as an idle one.
  // The brand hues resolve in neither theme and are classified in their own
  // table, and the sport and category palettes are fills in every entry.
  // It reads the token by name, so a site that reaches a hue through a local,
  // a prop or a function is invisible to it: that decision belongs in a
  // function a test can take, the way `sectionSizeTone.ts` holds one. The fill
  // series are the exception, followed through a local or a function in the
  // same file, because they are read by an index computed beside the style.
  'ground-token-text': {
    pathspec: ['src'],
    check(sources) {
      const table = sources.get('src/theme/tokenFamilies.ts') ?? '';
      const families = objectLiteral(table, 'TOKEN_FAMILIES');
      const brandFamilies = objectLiteral(table, 'BRAND_FAMILIES');
      if (!families || !brandFamilies)
        return [
          'src/theme/tokenFamilies.ts  has no TOKEN_FAMILIES and BRAND_FAMILIES objects for this rule to read',
        ];
      const textKeys = (literal) =>
        literal.properties
          .filter(
            (p) =>
              ts.isPropertyAssignment(p) &&
              ts.isStringLiteralLike(p.initializer) &&
              p.initializer.text === 'text'
          )
          .map(propertyName)
          .filter(Boolean);
      const grounds = families.properties
        .filter(
          (p) =>
            ts.isPropertyAssignment(p) &&
            ts.isStringLiteralLike(p.initializer) &&
            p.initializer.text !== 'text'
        )
        .map(propertyName)
        .filter(Boolean);
      if (grounds.length === 0)
        return ['src/theme/tokenFamilies.ts  names no ground or mark token'];
      // A brand key the table does not name is refused with the rest, so a new
      // hue has to be classified before it can be drawn as a word.
      const brandText = textKeys(brandFamilies);

      const offenders = [];
      for (const [file, text] of sources) {
        if (!/\.tsx?$/.test(file) || TESTS.test(file)) continue;
        if (/(?<![A-Za-z])color:\s*metric\.color\s*\}/.test(text)) {
          offenders.push({ file, token: 'metric.color' });
        }
        const seriesReads = fillSeriesReads(text);
        for (const region of styleRegions(text)) {
          for (const [pattern, series] of seriesReads) {
            if (pattern.test(region)) offenders.push({ file, token: `${series}[]` });
          }
          for (const [, value] of region.matchAll(/(?<![A-Za-z])color:([^,}\n]*)/g)) {
            for (const [, holder, token] of value.matchAll(
              /(?<![A-Za-z.])(colors|darkColors|chartColors|SPORT_COLORS|brand)\.([A-Za-z0-9_]+)/g
            )) {
              const ground =
                holder === 'SPORT_COLORS' ||
                (holder === 'brand' && !brandText.includes(token)) ||
                (holder === 'chartColors' &&
                  grounds.includes(`chart${token[0].toUpperCase()}${token.slice(1)}`)) ||
                ((holder === 'colors' || holder === 'darkColors') && grounds.includes(token));
              if (ground) offenders.push({ file, token: `${holder}.${token}` });
            }
            if (/(?<![A-Za-z.])ACTIVITY_CATEGORIES\b[^?:]*?\??\.color\b/.test(value)) {
              offenders.push({ file, token: 'ACTIVITY_CATEGORIES[…].color' });
            }
          }
        }
      }
      const out = offenders
        .filter((o) => !GROUND_TEXT_BASELINE.includes(o.file))
        .map((o) => `${o.file}  colours text with ${o.token}`);
      const seen = new Set(offenders.map((o) => o.file));
      for (const file of GROUND_TEXT_BASELINE.filter((f) => !seen.has(f))) {
        out.push(
          `${file}  is fixed: take it off GROUND_TEXT_BASELINE in scripts/lint-source-rules.mjs`
        );
      }
      return out;
    },
    fix: 'colour the text with a text-family token, the deep tone of the hue',
  },

  // `colors` holds the light value and `darkColors` the dark one. A token the
  // dark theme redefines, read as `colors.<token>` in a file that switches on
  // `isDark`, draws the light value in both themes unless the file reads
  // `darkColors.<token>` or the style has a `<name>Dark` sibling setting the same
  // property. The family check measures each theme on its own value, so that mix
  // is never measured.
  'dark-counterpart': {
    pathspec: ['src'],
    check(sources) {
      const families = objectLiteral(
        sources.get('src/theme/tokenFamilies.ts') ?? '',
        'TOKEN_FAMILIES'
      );
      const light = objectLiteral(sources.get('src/theme/colors.ts') ?? '', 'colors');
      const dark = objectLiteral(sources.get('src/theme/colors.ts') ?? '', 'darkColors');
      if (!families || !light || !dark) {
        return [
          'src/theme/tokenFamilies.ts and src/theme/colors.ts  need TOKEN_FAMILIES, colors and darkColors for this rule to read',
        ];
      }
      const initialisers = (literal) =>
        new Map(
          literal.properties
            .filter((p) => ts.isPropertyAssignment(p))
            .map((p) => [propertyName(p), p.initializer.getText()])
        );
      const lightValues = initialisers(light);
      const darkValues = initialisers(dark);
      const classified = new Set(
        families.properties.filter((p) => ts.isPropertyAssignment(p)).map(propertyName)
      );
      const tokens = DARK_COUNTERPART_TOKENS.filter(
        (token) =>
          classified.has(token) &&
          darkValues.has(token) &&
          darkValues.get(token) !== lightValues.get(token)
      );

      const out = [];
      for (const [file, text] of sources) {
        if (!/\.tsx?$/.test(file) || TESTS.test(file) || file.startsWith('src/theme/')) continue;
        if (!/\bisDark\b/.test(text)) continue;
        for (const site of lightOnlySites(text, tokens)) {
          out.push(`${file}:${site.line}  draws colors.${site.token} with no dark counterpart`);
        }
      }
      return out;
    },
    fix: 'build the style from the theme palette, `themedStyles(make, isDark)`, or read `isDark ? darkColors.<token> : colors.<token>`',
  },

  // A text token clears 4.5:1 at full strength, and the token test measures it
  // there. A style that draws it through an `opacity` below 1, or a colour
  // built at an alpha with `colorWithOpacity`, lands as a lighter colour that
  // test never sees: the tab bar's labels sat at 3.27:1 that way. The text of a
  // disabled control is exempt, as 1.4.3 exempts it, and a style key naming
  // `disabled` is read as one. Anything else measured and passing is listed in
  // DIMMED_TEXT_MEASURED with its measurement.
  'dimmed-text': {
    pathspec: ['src'],
    check(sources) {
      const flagged = [];
      for (const [file, text] of sources) {
        if (!/\.tsx?$/.test(file) || TESTS.test(file)) continue;
        if (!/opacity|colorWithOpacity/i.test(text)) continue;
        const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const visit = (node, inStyle) => {
          const styled =
            inStyle ||
            (ts.isCallExpression(node) && node.expression.getText(sf) === 'StyleSheet.create') ||
            (ts.isJsxAttribute(node) && /style$/i.test(node.name.getText(sf)));
          if (styled && ts.isObjectLiteralExpression(node)) {
            const props = node.properties.filter(ts.isPropertyAssignment);
            const prop = (key) => props.find((p) => propertyName(p) === key);
            const color = prop('color');
            const opacity = prop('opacity');
            const dimmed =
              color &&
              (/^colorWithOpacity\(/.test(color.initializer.getText(sf)) ||
                (opacity &&
                  ts.isNumericLiteral(opacity.initializer) &&
                  Number(opacity.initializer.text) < 1));
            if (dimmed) {
              const key =
                ts.isPropertyAssignment(node.parent) && propertyName(node.parent)
                  ? propertyName(node.parent)
                  : '(inline)';
              const line = sf.getLineAndCharacterOfPosition(color.getStart(sf)).line + 1;
              flagged.push({ file, key, line });
            }
          }
          ts.forEachChild(node, (child) => visit(child, styled));
        };
        visit(sf, false);
      }

      const out = flagged
        .filter(({ key }) => !/disabled/i.test(key))
        .filter(({ file, key }) => !DIMMED_TEXT_MEASURED[file]?.[key])
        .map(({ file, key, line }) => `${file}:${line}  ${key} dims a text colour`);
      for (const [file, keys] of Object.entries(DIMMED_TEXT_MEASURED)) {
        if (!sources.has(file)) continue;
        for (const key of Object.keys(keys)) {
          if (!flagged.some((f) => f.file === file && f.key === key)) {
            out.push(
              `${file}  ${key} no longer dims: take it off DIMMED_TEXT_MEASURED in scripts/lint-source-rules.mjs`
            );
          }
        }
      }
      return out;
    },
    fix: 'draw the text in a full-strength text token, textSecondary for the quieter line, or measure it on its ground and list it in DIMMED_TEXT_MEASURED',
  },

  // `textDisabled` is exempt from the text contrast bar only because it marks
  // an inactive control, and `divider` and `border` are lines, not ink. Drawn
  // as the colour of text or an icon anywhere else they put live content under
  // the bar. A use is in bounds inside a branch whose condition names a
  // disabled state, or in a style whose key does.
  // It reads the token by name, so a site that reaches one through a local or
  // a theme field is invisible to it.
  'disabled-ink-content': {
    pathspec: ['src'],
    check(sources) {
      const out = [];
      for (const [file, text] of sources) {
        if (!/\.tsx?$/.test(file) || TESTS.test(file) || file.startsWith('src/theme/')) continue;
        if (!DISABLED_INK.test(text)) continue;
        const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const visit = (node) => {
          const value = inkValue(node);
          if (value) {
            for (const token of disabledInkReads(value)) {
              if (!guardedByDisabled(token, node)) {
                const { line } = sf.getLineAndCharacterOfPosition(token.getStart(sf));
                out.push(`${file}:${line + 1}  colours content with ${token.getText(sf)}`);
              }
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(sf);
      }
      return out;
    },
    fix: 'draw live content in textSecondary, and keep textDisabled for a branch on a disabled state',
  },

  // The engine derives every `activity_metrics` row from the body it stores,
  // with one precedence per value. A row built in TypeScript beside it carries
  // a rule of its own and replaces the engine's, which is how push ingest
  // showed a second average power.
  'metrics-one-writer': {
    pathspec: ['src'],
    check(sources) {
      const writers = new Map();
      for (const [file, text] of sources) {
        if (!/\.tsx?$/.test(file) || TESTS.test(file)) continue;
        const lines = linesMatching(
          file,
          text,
          /^(?!\s*(?:\/\/|\*|\/\*)).*(?:\bsetActivityMetrics\w*\b|\.setMetrics\s*\()/
        );
        if (lines.length > 0) writers.set(file, lines);
      }
      const out = [...writers]
        .filter(([file]) => !METRICS_WRITE_BASELINE.includes(file))
        .flatMap(([, lines]) => lines);
      for (const file of METRICS_WRITE_BASELINE.filter((f) => !writers.has(f))) {
        out.push(
          `${file}  is fixed: take it off METRICS_WRITE_BASELINE in scripts/lint-source-rules.mjs`
        );
      }
      return out;
    },
    fix: 'store the body through the engine and let it write the metrics row',
  },

  // The engine's open creates the database and its journal files, and a file
  // opened outside `openLibrary` is never marked out of the iOS device backup.
  'one-library-open': {
    pathspec: ['src'],
    check(sources) {
      const OWNER = 'src/shared/storage/routeDbLocation.ts';
      if (!sources.has(OWNER)) return [`${OWNER}  is gone: it owns the library open`];
      const out = [];
      for (const [file, text] of sources) {
        if (file === OWNER || !/\.tsx?$/.test(file) || TESTS.test(file)) continue;
        out.push(...linesMatching(file, text, /^(?!\s*(?:\/\/|\*|\/\*)).*\.initWithPath\s*\(/));
      }
      return out;
    },
    fix: 'open the library with openLibrary(engine, dbPath) from @/shared/storage/routeDbLocation',
  },

  // `router.back()` on a screen with nothing beneath it, as one a cold link or a
  // replace left as the stack root, dispatches a pop nothing handles, so the
  // control gives a haptic and the screen stays. `goBack` goes to the Feed then.
  'one-back': {
    pathspec: ['src'],
    check(sources) {
      const OWNER = 'src/shared/app/navigation.ts';
      if (!sources.has(OWNER)) return [`${OWNER}  is gone: it owns the root-safe back`];
      const out = [];
      for (const [file, text] of sources) {
        if (file === OWNER || !/\.tsx?$/.test(file) || TESTS.test(file)) continue;
        out.push(...linesMatching(file, text, /^(?!\s*(?:\/\/|\*|\/\*)).*\brouter\.back\b/));
      }
      return out;
    },
    fix: 'leave the screen with goBack or tapBack from @/shared/app/navigation',
  },

  // A form field is drawn by the shared TextField, which carries the visible
  // label as the accessible name, the 3:1 edge, the error line and the themed
  // keyboard. An input drawn anywhere else gets none of them, so the value
  // import of TextInput from either library is held to the field and to the
  // search bar, which is its own control.
  'one-text-field': {
    pathspec: ['src'],
    check(sources) {
      const OWNERS = ['src/shared/ui/TextField.tsx', 'src/shared/ui/SearchBar.tsx'];
      const gone = OWNERS.filter((owner) => !sources.has(owner));
      if (gone.length > 0) return gone.map((owner) => `${owner}  is gone: it owns a text input`);
      const IMPORT = /import\s*(type\s+)?\{([^}]*)\}\s*from\s*'react-native(?:-paper)?'/g;
      const out = [];
      for (const [file, text] of sources) {
        if (OWNERS.includes(file) || !/\.tsx?$/.test(file) || TESTS.test(file)) continue;
        for (const match of text.matchAll(IMPORT)) {
          if (match[1]) continue;
          const names = match[2].split(',').map((name) => name.trim());
          if (!names.some((name) => /^TextInput(\s+as\s+\w+)?$/.test(name))) continue;
          const line = text.slice(0, match.index).split('\n').length;
          out.push(`${file}:${line}  imports TextInput`);
        }
      }
      return out;
    },
    fix: 'draw the field with TextField from @/shared/ui, which names it by its label',
  },

  // `src/shared/` is the layer every feature imports, so a cycle inside it is a
  // module-initialisation order bug waiting for the one import that trips it.
  'shared-import-cycles': {
    pathspec: ['src/shared'],
    check(sources) {
      const files = [...sources.keys()].filter((f) => /\.tsx?$/.test(f));
      const known = new Set(files);
      const edges = new Map();
      for (const file of files) {
        const targets = [];
        for (const match of sources.get(file).matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
          const base = posix.normalize(posix.join(posix.dirname(file), match[1]));
          const hit = [
            base,
            `${base}.ts`,
            `${base}.tsx`,
            `${base}/index.ts`,
            `${base}/index.tsx`,
          ].find((c) => known.has(c));
          if (hit) targets.push(hit);
        }
        edges.set(file, targets);
      }
      const cycles = [];
      const done = new Set();
      const onPath = [];
      const visit = (file) => {
        const at = onPath.indexOf(file);
        if (at !== -1) {
          cycles.push([...onPath.slice(at), file].join(' -> '));
          return;
        }
        if (done.has(file)) return;
        done.add(file);
        onPath.push(file);
        for (const target of edges.get(file)) visit(target);
        onPath.pop();
      };
      for (const file of files) visit(file);
      return cycles;
    },
    fix: 'move what both modules need into a third module that imports neither',
  },

  // Every pressable in the shared components carries a role and a label, so a
  // screen that adopts one inherits both. A tag spreading `{...props}` takes
  // them from its caller. A file with tab children also declares the tablist
  // that lets a screen reader count them.
  'shared-ui-accessibility': {
    pathspec: ['src/shared/ui'],
    check(sources) {
      const out = [];
      let found = 0;
      for (const [file, text] of sources) {
        if (!/^src\/shared\/ui\/[^/]+\.tsx$/.test(file)) continue;
        if (
          /accessibilityRole=["']tab["']/.test(text) &&
          !/accessibilityRole=["']tablist["']/.test(text)
        )
          out.push(
            `${file}:1  has accessibilityRole="tab" children and no accessibilityRole="tablist" container`
          );
        for (const match of text.matchAll(
          /<(TouchableOpacity|Pressable|AnimatedPressable|Text)\b/g
        )) {
          // The opening tag ends at the first `>` outside a brace-delimited prop.
          let depth = 0;
          let tag = null;
          for (let i = match.index; i < text.length; i += 1) {
            const c = text[i];
            if (c === '{') depth += 1;
            else if (c === '}') depth -= 1;
            else if (c === '>' && depth === 0) {
              tag = text.slice(match.index, i);
              break;
            }
          }
          if (tag === null) continue;
          // A Text is a control only when it takes a press.
          if (match[1] === 'Text' && !tag.includes('onPress')) continue;
          found += 1;
          if (tag.includes('{...props}')) continue;
          const line = text.slice(0, match.index).split('\n').length;
          if (!tag.includes('accessibilityRole'))
            out.push(`${file}:${line}  has no accessibilityRole`);
          if (!tag.includes('accessibilityLabel'))
            out.push(`${file}:${line}  has no accessibilityLabel or accessibilityLabelledBy`);
        }
      }
      if (found <= 10)
        out.push(`found ${found} pressables under src/shared/ui, so this rule reads nothing`);
      return out;
    },
    fix: 'give the pressable an accessibilityRole and an accessibilityLabel that says what it does',
  },

  // A banner that appears on its own is spoken by a screen reader: Android
  // through a live region on its outer view, iOS through an announcement when
  // it mounts. Each listed banner declares both, or draws the shared
  // NoticeBanner, which is listed and declares both for it. A result, error or
  // fallback that appears in place does the same through `StatusLine`, which
  // carries both, so each listed file renders one, and so does every error
  // boundary under src/shared/ui, including one added later.
  'banner-live-region': {
    pathspec: ['src'],
    check(sources) {
      const out = [];
      const statusOwner = 'src/shared/ui/StatusLine.tsx';
      const statusFiles = [
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
      const owner = sources.get(statusOwner);
      if (owner === undefined) out.push(`${statusOwner}  is gone, and every status line with it`);
      else if (
        !owner.includes('accessibilityLiveRegion=') ||
        !owner.includes('useAnnounceOnAppear(')
      )
        out.push(`${statusOwner}  no longer carries both a live region and an announcement`);
      const boundaries = [...sources.keys()].filter((file) =>
        /^src\/shared\/ui\/[A-Za-z]+ErrorBoundary\.tsx$/.test(file)
      );
      if (boundaries.length === 0) out.push('found no error boundary under src/shared/ui');
      for (const file of [...statusFiles, ...boundaries]) {
        const text = sources.get(file);
        if (text === undefined) {
          out.push(`${file}  is gone: remove it from this list`);
          continue;
        }
        if (!text.includes('<StatusLine')) out.push(`${file}  shows a status outside a StatusLine`);
      }
      const bannerFiles = [
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
      for (const file of bannerFiles) {
        const text = sources.get(file);
        if (text === undefined) {
          out.push(`${file}  is fixed: remove it from this list`);
          continue;
        }
        if (file !== 'src/shared/ui/NoticeBanner.tsx' && text.includes('<NoticeBanner')) continue;
        if (!text.includes('accessibilityLiveRegion='))
          out.push(`${file}  has no accessibilityLiveRegion`);
        if (!text.includes('useAnnounceOnAppear(')) out.push(`${file}  never announces on iOS`);
      }
      return out;
    },
    fix: 'draw the banner with NoticeBanner, or give its view an accessibilityLiveRegion and call useAnnounceOnAppear with its text; draw a result, error or fallback inside a StatusLine',
  },

  // A chip whose look depends on a selected or active flag also says so to a
  // screen reader, since a tint is not a cue everyone can see. It holds the
  // four selector components that were converted, and a file added to the list
  // joins them.
  'selected-state-accessibility': {
    pathspec: ['src'],
    check(sources) {
      const out = [];
      const chipFiles = [
        'src/features/routes/components/SportTypeSelector.tsx',
        'src/features/activity/components/ChartTypeSelector.tsx',
        'src/features/routes/components/preview/PreviewCentrePicker.tsx',
      ];
      let found = 0;
      for (const [file, text] of sources) {
        if (!chipFiles.includes(file)) continue;
        found += 1;
        for (const match of text.matchAll(/<(TouchableOpacity|Pressable|AnimatedPressable)\b/g)) {
          let depth = 0;
          let tag = null;
          for (let i = match.index; i < text.length; i += 1) {
            const c = text[i];
            if (c === '{') depth += 1;
            else if (c === '}') depth -= 1;
            else if (c === '>' && depth === 0 && text[i - 1] !== '=') {
              tag = text.slice(match.index, i);
              break;
            }
          }
          if (tag === null || tag.includes('{...props}')) continue;
          if (!/\b(?:isSelected|selected|isActive|active|bgColor)\b/.test(tag)) continue;
          if (tag.includes('accessibilityState')) continue;
          const line = text.slice(0, match.index).split('\n').length;
          out.push(
            `${file}:${line}  styles itself by a selected or active flag with no accessibilityState`
          );
        }
      }
      if (found < chipFiles.length) out.push(`found ${found} of ${chipFiles.length} chip files`);
      return out;
    },
    fix: 'add accessibilityRole and accessibilityState={{ selected }} to the pressable',
  },

  // iOS Smart Invert inverts every view that does not opt out, so a map or a
  // photo becomes a negative: satellite imagery, the terrain drape, route and
  // heatmap hues, faces. Every on-screen map WebView and every `Image` drawn
  // from a URI carries `accessibilityIgnoresInvertColors`, on itself or on an
  // element around it. The snapshot workers are never seen, since they render
  // behind the content at near-zero opacity, and their output reaches the
  // screen through an `Image` this holds.
  'invert-colors-opt-out': {
    pathspec: ['src'],
    check(sources) {
      const out = [];
      for (const file of INVERT_EXEMPT) {
        if (!sources.has(file)) out.push(`${file}  is gone: remove it from the exemptions`);
      }
      for (const [file, text] of sources) {
        if (!file.endsWith('.tsx') || TESTS.test(file) || INVERT_EXEMPT.includes(file)) continue;
        out.push(...invertUnprotectedSites(file, text));
      }
      return out;
    },
    fix: 'set accessibilityIgnoresInvertColors on the WebView or Image, or on the View around it',
  },

  // A point leaves the device for a place name only through the engine's one
  // geocoder, which is off until the athlete turns it on, paces its requests
  // and keeps every answer. So a geocoding host may be named in that file and
  // nowhere else, and this holds the three ways a second geocoder comes back:
  // the platform geocoder, a geocoding host named in TypeScript or another
  // engine file, and a TypeScript module of that name. It matches the host and
  // not the word, so a comment naming a geocoder's policy page stays legal.
  'no-geocoding': {
    pathspec: ['src', 'modules/veloqrs/rust/veloqrs/src'],
    check(sources) {
      const out = [];
      GEOCODING_PATTERNS.forEach((pattern, i) => {
        if (!pattern.test(GEOCODING_PROBES[i]))
          out.push(`pattern ${i} no longer matches its own probe, so it checks nothing`);
      });
      for (const [file, text] of sources) {
        if (TESTS.test(file)) continue;
        if (/^src\/shared\/geo\/[^/]*geocod/i.test(file))
          out.push(`${file}  is a geocoding module`);
        if (!/\.(?:tsx?|rs)$/.test(file)) continue;
        for (const pattern of GEOCODING_PATTERNS) {
          if (file === ENGINE_GEOCODER && pattern === GEOCODING_HOSTS) continue;
          out.push(...linesMatching(file, text, pattern));
        }
      }
      return out;
    },
    fix: 'ask the engine geocoder in net/geocode.rs, which holds the switch, the pace and the kept answers',
  },

  // Every key in the reference locale is reached, by its full dotted path in
  // the source or by a template prefix built at runtime from a last segment the
  // sweep cannot see. A new orphan fails here, in all locales at once.
  'unused-i18n-keys': {
    pathspec: ['src'],
    check(sources) {
      const reference = sources.get(REFERENCE_LOCALE);
      if (reference === undefined) return [`${REFERENCE_LOCALE}  is not tracked`];
      const tokens = new Set();
      for (const [file, text] of sources) {
        // The prebuild plugins read keys by full path too, for the text the
        // native targets compile in.
        const reader = /\.tsx?$/.test(file) || /^src\/plugins\/[^/]+\.js$/.test(file);
        if (!reader || TESTS.test(file)) continue;
        if (file.startsWith('src/i18n/locales/') || file === 'src/i18n/types.ts') continue;
        for (const token of text.match(/[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+/g) ?? [])
          tokens.add(token);
      }
      const reached = (key) =>
        tokens.has(key) ||
        DYNAMIC_KEYS.includes(key) ||
        DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix));
      return leafKeys(JSON.parse(reference)).filter((key) => {
        if (reached(key)) return false;
        const base = key.replace(PLURAL_SUFFIX, '');
        return base === key || !reached(base);
      });
    },
    fix: 'delete the key from every locale, or list its prefix or exact keys in scripts/lint-source-rules.mjs when the runtime builds it',
  },
};

const name = flag('--rule');
const rule = RULES[name];
if (!rule) {
  console.error(`lint-source-rules: --rule is one of ${Object.keys(RULES).join(', ')}`);
  process.exit(2);
}

const sources = new Map(
  [...indexedSources(root, rule.pathspec)].map(([file, bytes]) => [file, bytes.toString('utf8')])
);
refuseEmptyListing(sources, `Source rule ${name}`);

const failures = rule.check(sources);
if (failures.length > 0) {
  console.error(`Source rule ${name}: ${failures.length} to fix. Instead, ${rule.fix}.\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`Source rule ${name}: holds.`);
