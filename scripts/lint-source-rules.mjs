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
  'src/app/(tabs)/training.tsx': 'DEFAULT_PERIOD',
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
 * Text tokens whose light value is read through the static `colors` object and
 * whose dark value differs, so a style that names only the light one is wrong
 * in the dark theme. The body tokens are left out: the theme hook hands those
 * out already resolved for the active theme.
 */
const DARK_COUNTERPART_TOKENS = ['linkTeal'];

/**
 * TypeScript sites that still write `activity_metrics` and are another item's
 * to remove. Like the ground baseline it only shrinks: an entry that has
 * stopped writing fails the rule rather than going quiet.
 */
const METRICS_WRITE_BASELINE = ['src/features/routes/hooks/useGpsDataFetcher.ts'];

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
  'recording.categories.',
  'recording.fields.',
  'recording.gpsModes.',
  'recording.library.status.',
  'recording.rpeLabels.',
  'recording.timeOfDay.',
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

const GEOCODING_PATTERNS = [
  /\b(?:reverseGeocodeAsync|geocodeAsync)\b/,
  /nominatim\.openstreetmap\.org|photon\.komoot\.(?:io|de)|geocode\.maps\.co|api\.opencagedata\.com|maps\.googleapis\.com\/maps\/api\/geocode|api\.mapbox\.com\/geocoding|geocoding-api\.open-meteo\.com/,
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
        if (file.startsWith('src/app/')) {
          out.push(...linesMatching(file, text, /(?:icon|name)=["']arrow-left["']/));
        }
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
      // The tab screens and the login screen take no header and draw their
      // own title row, so the ban on a hand-rolled one does not reach them.
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

      const layout = sources.get('src/app/_layout.tsx') ?? '';
      const screenOptions = layout.slice(layout.indexOf('<Stack'), layout.indexOf('<Stack.Screen'));
      if (/headerShown:\s*false/.test(screenOptions)) {
        out.push('src/app/_layout.tsx  turns the header off for the whole root stack');
      }

      const shared = sources.get('src/styles/shared.ts') ?? '';
      for (const key of ['header:', 'headerTitle:', 'backButton:']) {
        if (shared.includes(key)) out.push(`src/styles/shared.ts  carries the copied ${key} style`);
      }
      return out;
    },
    fix: 'declare the header in SCREEN_HEADERS and let the native stack draw it',
  },

  // A label with no `text-font` takes the style spec's default stack, which the
  // app does not carry, so its glyphs cost a bridge round trip and a 404.
  'glyph-stacks': {
    pathspec: LAYER_SCRIPTS,
    check(sources) {
      const out = named(sources, LAYER_SCRIPTS);
      for (const file of LAYER_SCRIPTS) {
        const text = sources.get(file);
        if (text === undefined) continue;
        const fields = text.split("'text-field'").length - 1;
        const fonts = text.split("'text-font'").length - 1;
        if (fields === 0) out.push(`${file}  has no text-field for this rule to read`);
        else if (fonts !== fields) {
          out.push(`${file}  names ${fields} text-field and ${fonts} text-font`);
        }
      }
      return out;
    },
    fix: "give every 'text-field' a 'text-font' from BUNDLED_GLYPH_STACKS in the same layout",
  },

  // A ground or a mark is not a text token because it answers to a lower bar
  // than text does. `color:` is the text property, so one there is a hue that
  // is held to less than 4.5:1 and drawn as a word.
  // It reads the token by name, so a site that reaches a hue through a local,
  // a prop or a function is invisible to it: that decision belongs in a
  // function a test can take, the way `sectionSizeTone.ts` holds one.
  'ground-token-text': {
    pathspec: ['src'],
    check(sources) {
      const families = objectLiteral(
        sources.get('src/theme/tokenFamilies.ts') ?? '',
        'TOKEN_FAMILIES'
      );
      if (!families)
        return ['src/theme/tokenFamilies.ts  has no TOKEN_FAMILIES object for this rule to read'];
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

      const offenders = [];
      for (const [file, text] of sources) {
        if (!/\.tsx?$/.test(file) || TESTS.test(file)) continue;
        if (/(?<![A-Za-z])color:\s*metric\.color\s*\}/.test(text)) {
          offenders.push({ file, token: 'metric.color' });
        }
        for (const region of styleRegions(text)) {
          for (const [, holder, token] of region.matchAll(
            /(?<![A-Za-z])color:\s*(colors|darkColors|chartColors|SPORT_COLORS)\.([A-Za-z0-9_]+)/g
          )) {
            const ground =
              holder === 'SPORT_COLORS' ||
              (holder === 'chartColors' &&
                grounds.includes(`chart${token[0].toUpperCase()}${token.slice(1)}`)) ||
              ((holder === 'colors' || holder === 'darkColors') && grounds.includes(token));
            if (ground) offenders.push({ file, token: `${holder}.${token}` });
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

  // `colors` holds the light value and `darkColors` the dark one. A text token
  // that the dark theme redefines, read as `colors.<token>` in a file that
  // switches on `isDark` and never reads `darkColors.<token>`, draws the light
  // value in both themes. The family check measures each theme on its own
  // value, so that mix is never measured.
  'dark-text-counterpart': {
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
      const textTokens = families.properties
        .filter(
          (p) =>
            ts.isPropertyAssignment(p) &&
            ts.isStringLiteralLike(p.initializer) &&
            p.initializer.text === 'text'
        )
        .map(propertyName);
      const tokens = DARK_COUNTERPART_TOKENS.filter(
        (token) =>
          textTokens.includes(token) &&
          darkValues.has(token) &&
          darkValues.get(token) !== lightValues.get(token)
      );

      const out = [];
      for (const [file, text] of sources) {
        if (!/\.tsx?$/.test(file) || TESTS.test(file) || file.startsWith('src/theme/')) continue;
        if (!/\bisDark\b/.test(text)) continue;
        for (const token of tokens) {
          const read = new RegExp(`(?<![A-Za-z.])color:\\s*colors\\.${token}\\b`);
          const dim = new RegExp(`darkColors\\.${token}\\b`);
          if (read.test(text) && !dim.test(text)) {
            out.push(
              `${file}  colours text with colors.${token} and never reads darkColors.${token}`
            );
          }
        }
      }
      return out;
    },
    fix: 'read `isDark ? darkColors.<token> : colors.<token>`, or a dark style that sets the dark token',
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
  // it mounts. Each listed file declares both.
  'banner-live-region': {
    pathspec: ['src'],
    check(sources) {
      const out = [];
      const bannerFiles = [
        'src/shared/ui/OfflineBanner.tsx',
        'src/features/recording/components/SaveErrorBanner.tsx',
        'src/shared/ui/SyncProgressStrip.tsx',
        'src/features/maps/components/timeline/SyncProgressBanner.tsx',
      ];
      for (const file of bannerFiles) {
        const text = sources.get(file);
        if (text === undefined) {
          out.push(`${file}  is fixed: remove it from this list`);
          continue;
        }
        if (!text.includes('accessibilityLiveRegion='))
          out.push(`${file}  has no accessibilityLiveRegion`);
        if (!text.includes('useAnnounceOnAppear(')) out.push(`${file}  never announces on iOS`);
      }
      return out;
    },
    fix: 'give the banner view an accessibilityLiveRegion and call useAnnounceOnAppear with its text',
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

  // Coordinates never leave the device for a place name. The geocoding module
  // is gone, so this holds the three ways it comes back: the platform
  // geocoder, a geocoding host named in TypeScript or the engine, and a module
  // of that name. It matches the host and not the word, so a comment naming
  // a geocoder's policy page stays legal.
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
        for (const pattern of GEOCODING_PATTERNS) out.push(...linesMatching(file, text, pattern));
      }
      return out;
    },
    fix: 'resolve the name from data the engine already holds, and send no coordinates to a geocoder',
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
