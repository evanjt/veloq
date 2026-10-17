// Every style property class the app sets, the token in `src/theme` that owns
// it, and the guard that refuses a value written by hand.
//
// The guards were added one slice at a time, each by the work that needed it,
// so nothing listed the whole set or noticed a class nobody owned: weight, line
// height, border width, stroke width, icon size, layer and motion were all
// written as literals at hundreds of sites with no owner and no guard. This
// table is the set. `check-style-owners.mjs` reads every style key the app
// sets and fails on one this table does not place, so a new class cannot
// arrive unowned, and `lint-style-literals.mjs --class <name>` is the guard
// for each class the ESLint scale rules do not already hold.
//
// A class with no `owner` yet is held by its guard alone: the count of its
// literals only falls, and the token that replaces them lands with the sweep.

import { posix } from 'node:path';

import ts from 'typescript';

/**
 * @typedef {object} StyleClass
 * @property {string} name the class, as `--class` takes it
 * @property {string[]} keys the style keys, props and calls it covers
 * @property {string[]} owner the `src/theme` exports that own it, empty when none does yet
 * @property {string | null} guard a `scripts/run-guards.mjs` guard, `eslint:<selector const>`,
 *   or null when the owner alone holds it
 * @property {string} instead what the guard tells an author to write instead
 */

const BORDER_COLOUR_SIDES = ['Top', 'Bottom', 'Left', 'Right', 'Start', 'End'];
const BORDER_WIDTH_KEYS = new Set([
  'borderWidth',
  ...BORDER_COLOUR_SIDES.map((side) => `border${side}Width`),
]);

/** @type {StyleClass[]} */
export const STYLE_CLASSES = [
  {
    name: 'colour',
    keys: [
      'color',
      'backgroundColor',
      'borderColor',
      ...BORDER_COLOUR_SIDES.map((side) => `border${side}Color`),
      'shadowColor',
      'textShadowColor',
      'textDecorationColor',
      'tintColor',
      'overlayColor',
      'placeholderTextColor',
    ],
    owner: ['colors', 'darkColors'],
    guard: 'eslint:hexSelector',
    instead: 'a colour token from src/theme',
  },
  {
    name: 'font-size',
    keys: ['fontSize'],
    owner: ['typography'],
    guard: 'eslint:fontSizeSelector',
    instead: 'a typography role',
  },
  {
    name: 'font-weight',
    keys: ['fontWeight'],
    owner: ['typography'],
    guard: 'lint:style-font-weight',
    instead: 'spread a typography role, which carries its weight',
  },
  {
    name: 'line-height',
    keys: ['lineHeight'],
    owner: ['typography'],
    guard: 'lint:style-line-height',
    instead: 'spread a typography role, which carries its line height',
  },
  {
    name: 'letter-spacing',
    keys: ['letterSpacing'],
    owner: ['typography'],
    guard: 'lint:style-letter-spacing',
    instead: 'spread a typography role, which carries its tracking',
  },
  {
    name: 'font-family',
    keys: ['fontFamily'],
    owner: ['typography'],
    guard: 'lint:style-font-family',
    instead: 'spread a typography role, which carries its family',
  },
  {
    name: 'font-style',
    keys: ['fontStyle'],
    owner: [],
    guard: 'lint:style-font-style',
    instead: 'secondary text colour or an icon: the app draws no italic',
  },
  {
    name: 'font-variant',
    keys: ['fontVariant'],
    owner: ['typography'],
    guard: null,
    instead: 'a numeric typography role, which carries tabular figures',
  },
  {
    name: 'spacing',
    keys: [
      'padding',
      'margin',
      ...['Top', 'Bottom', 'Left', 'Right', 'Horizontal', 'Vertical', 'Start', 'End'].flatMap(
        (side) => [`padding${side}`, `margin${side}`]
      ),
      'gap',
      'rowGap',
      'columnGap',
    ],
    owner: ['spacing'],
    guard: 'eslint:spacingSelector',
    instead: 'a spacing token',
  },
  {
    name: 'radius',
    keys: [
      'borderRadius',
      ...['Top', 'Bottom'].flatMap((v) =>
        ['Left', 'Right', 'Start', 'End'].map((h) => `border${v}${h}Radius`)
      ),
    ],
    owner: ['layout'],
    guard: 'eslint:radiusSelector',
    instead: 'a layout.borderRadius* token',
  },
  {
    name: 'border-width',
    keys: [...BORDER_WIDTH_KEYS],
    owner: ['stroke'],
    guard: 'lint:style-border-width',
    instead: 'stroke.hairline, stroke.one, stroke.two or stroke.three, or 0 for none',
  },
  {
    name: 'stroke-width',
    keys: ['strokeWidth'],
    owner: [],
    guard: 'lint:style-stroke-width',
    instead: 'a named stroke from src/theme',
  },
  {
    name: 'icon-size',
    keys: ['size'],
    owner: [],
    guard: 'lint:style-icon-size',
    instead: 'an icon size from src/theme',
  },
  {
    name: 'shadow',
    keys: ['elevation', 'shadowOpacity', 'shadowRadius', 'shadowOffset', 'createShadow'],
    owner: ['shadows', 'createShadow', 'smallElementShadow'],
    guard: 'lint:style-shadow',
    instead: 'a shadows.* preset',
  },
  {
    name: 'text-shadow',
    keys: ['textShadowOffset', 'textShadowRadius'],
    owner: ['mapTextShadow'],
    guard: 'eslint:textShadowRadiusSelector',
    instead: 'mapTextShadow',
  },
  {
    name: 'opacity',
    keys: ['opacity', 'activeOpacity'],
    owner: ['opacity'],
    guard: 'lint:style-opacity',
    instead: 'an opacity.* step, or the shared press feedback',
  },
  {
    name: 'alpha',
    keys: ['colorWithOpacity'],
    owner: ['colorWithOpacity', 'opacity'],
    guard: 'lint:style-alpha',
    instead: 'colorWithOpacity(token, opacity.<step>)',
  },
  {
    name: 'z-index',
    keys: ['zIndex'],
    owner: ['layers', 'floatingLayers'],
    guard: 'lint:style-z-index',
    instead: 'a named layer from src/theme',
  },
  {
    name: 'motion',
    keys: ['duration', 'delay', 'withDelay'],
    owner: ['duration', 'easing', 'motionPairs', 'motionPresets', 'cameraMove'],
    guard: 'lint:style-motion',
    instead: 'duration.<rung>, motionPresets.<pair> or cameraMove.<move> from src/theme',
  },
  {
    name: 'container',
    keys: [],
    owner: [],
    guard: 'lint:style-containers',
    instead:
      'Card, Button, ChipSelector, TextField, NoticeBanner, SheetHeader or Row from src/shared/ui',
  },
  {
    name: 'theme-import',
    keys: [],
    owner: [],
    guard: 'lint:style-theme-imports',
    instead: "import from '@/theme', the one public surface",
  },
];

/**
 * Keys that place or shape one element rather than draw the design language:
 * flex layout, position, geometry, text alignment and casing. They have no
 * scale to draw from, so no token owns them, and the completeness check lets
 * them pass. A key missing from here and from every class fails that check.
 */
export const STRUCTURAL_KEYS = [
  'alignContent',
  'alignItems',
  'alignSelf',
  'aspectRatio',
  'backfaceVisibility',
  'bottom',
  'direction',
  'display',
  'end',
  'flex',
  'flexBasis',
  'flexDirection',
  'flexGrow',
  'flexShrink',
  'flexWrap',
  'height',
  'includeFontPadding',
  'inset',
  'justifyContent',
  'left',
  'maxHeight',
  'maxWidth',
  'minHeight',
  'minWidth',
  'overflow',
  'pointerEvents',
  'position',
  'resizeMode',
  'right',
  'start',
  'textAlign',
  'textAlignVertical',
  'textDecorationLine',
  'textTransform',
  'top',
  'transform',
  'transformOrigin',
  'width',
  'writingDirection',
];

/** Where the classes are judged: the app source, less the owner and the tests. */
export function judged(rel) {
  return (
    rel.startsWith('src/') &&
    /\.tsx?$/.test(rel) &&
    !rel.startsWith('src/theme/') &&
    !/(^|\/)(__tests__|__mocks__)\//.test(rel) &&
    !/\.test\.tsx?$/.test(rel)
  );
}

/**
 * Whether `className` judges `rel`. The containers are built in
 * `src/shared/ui`, so a card or a button drawn there is the owner, not a copy.
 */
export function judgedFor(className, rel) {
  if (className === 'container' && rel.startsWith('src/shared/ui/')) return false;
  return judged(rel);
}

export function parse(rel, text) {
  return ts.createSourceFile(
    rel,
    text,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function keyName(name) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return null;
}

const unwrap = (expr) => {
  let at = expr;
  while (
    at &&
    (ts.isParenthesizedExpression(at) ||
      ts.isAsExpression(at) ||
      ts.isSatisfiesExpression(at) ||
      ts.isNonNullExpression(at))
  ) {
    at = at.expression;
  }
  return at;
};

/**
 * The literals a value is written as: the value itself, either branch of a
 * conditional, or the fallback of `??` and `||`. A zero is not counted, since
 * it removes the property's effect rather than choosing a step, and neither is
 * an opacity of one.
 */
function literals(expr, { skipOne = false, objects = false } = {}) {
  const value = unwrap(expr);
  if (!value) return [];
  if (ts.isConditionalExpression(value)) {
    return [
      ...literals(value.whenTrue, { skipOne, objects }),
      ...literals(value.whenFalse, { skipOne, objects }),
    ];
  }
  if (
    ts.isBinaryExpression(value) &&
    (value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      value.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return literals(value.right, { skipOne, objects });
  }
  if (
    ts.isPrefixUnaryExpression(value) &&
    value.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(value.operand)
  ) {
    return [`-${value.operand.text}`];
  }
  if (ts.isNumericLiteral(value)) {
    const n = Number(value.text);
    if (n === 0 || (skipOne && n === 1)) return [];
    return [value.text];
  }
  if (ts.isStringLiteralLike(value)) return [value.text];
  if (objects && ts.isObjectLiteralExpression(value)) {
    const numbers = value.properties.flatMap((p) =>
      ts.isPropertyAssignment(p) ? literals(p.initializer) : []
    );
    return numbers.length > 0 ? [value.getText()] : [];
  }
  return [];
}

/**
 * The parts of a border width that are not a stroke read, as source text. A
 * width is drawn from the four in `stroke` or switched off with 0, so a number,
 * the platform hairline read directly, a local constant and any arithmetic on
 * them are all a fifth width nobody chose. Either branch of a conditional and
 * both sides of `??` and `||` are judged.
 */
function nonStrokeWidths(expr, sf) {
  const value = unwrap(expr);
  if (!value) return [];
  if (ts.isConditionalExpression(value)) {
    return [...nonStrokeWidths(value.whenTrue, sf), ...nonStrokeWidths(value.whenFalse, sf)];
  }
  if (
    ts.isBinaryExpression(value) &&
    (value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      value.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return [...nonStrokeWidths(value.left, sf), ...nonStrokeWidths(value.right, sf)];
  }
  if (ts.isNumericLiteral(value) && Number(value.text) === 0) return [];
  if (ts.isIdentifier(value) && value.text === 'undefined') return [];
  if (
    ts.isPropertyAccessExpression(value) &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === 'stroke'
  ) {
    return [];
  }
  // A width handed on from another object's own border width was judged where
  // that object set it, as a control's skin is.
  if (ts.isPropertyAccessExpression(value) && BORDER_WIDTH_KEYS.has(value.name.text)) return [];
  return [value.getText(sf)];
}

/** A JSX attribute's value expression, a quoted attribute included. */
function attributeValue(attr) {
  const init = attr.initializer;
  if (!init) return undefined;
  if (ts.isStringLiteral(init)) return init;
  if (ts.isJsxExpression(init)) return init.expression;
  return undefined;
}

function calleeName(call) {
  const callee = unwrap(call.expression);
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

const ANIMATION_CONFIG_CALLS = new Set([
  'withTiming',
  'withSpring',
  'withDecay',
  'timing',
  'spring',
  'decay',
  'configureNext',
  'motionTiming',
]);

/** Camera moves, by the argument count at which the last one is the duration. */
const CAMERA_CALLS = new Map([
  ['setCamera', 2],
  ['fitBounds', 3],
]);

/** Whether an object is handed straight to a timing call, which counts it already. */
function isAnimationConfigArgument(object) {
  let child = object;
  let parent = object.parent;
  while (
    parent &&
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent))
  ) {
    child = parent;
    parent = parent.parent;
  }
  return (
    !!parent &&
    ts.isCallExpression(parent) &&
    parent.arguments.includes(child) &&
    ANIMATION_CONFIG_CALLS.has(calleeName(parent))
  );
}

/** The style objects a container name is matched against, by kind. */
const CONTAINER_KINDS = [
  ['card', /card/i, 'surface'],
  ['button', /(button|btn)/i, 'surface'],
  ['chip', /(chip|pill)/i, 'surface'],
  ['field', /(input|field)/i, 'surface'],
  ['banner', /(banner|notice)/i, 'fill'],
  ['sheet header', /sheetHeader/i, 'any'],
  ['row', /row$/i, 'divider'],
];

const DIVIDER_KEYS = new Set(['borderBottomWidth', 'borderTopWidth']);

/**
 * The kind of container a `StyleSheet.create` entry draws by hand, or null.
 * A card, button, chip or field is a filled or bordered shape with a radius;
 * a banner is a filled strip; a row is one with a divider rule. The name says
 * which, the keys say it draws a surface rather than lays out.
 */
function containerKind(name, style) {
  const keys = new Set(style.properties.map((p) => keyName(p.name)).filter(Boolean));
  const filled = keys.has('backgroundColor');
  const bordered = keys.has('borderWidth');
  const rounded = keys.has('borderRadius');
  for (const [kind, pattern, needs] of CONTAINER_KINDS) {
    if (!pattern.test(name)) continue;
    if (needs === 'any') return kind;
    if (needs === 'surface' && (filled || bordered) && rounded) return kind;
    if (needs === 'fill' && filled) return kind;
    if (needs === 'divider' && [...keys].some((k) => DIVIDER_KEYS.has(k))) return kind;
  }
  return null;
}

const NUMBER = /^-?[0-9.]+$/;

/**
 * Whether a literal is a value of the class: a weight may be written either
 * way, a family is a name, a style is only refused when it is italic, and
 * every other class is a number, so a string under a shared key such as an
 * `opacity` label is not one.
 */
function accepts(className, value, objects) {
  if (className === 'font-weight') return true;
  if (className === 'font-family') return !NUMBER.test(value);
  if (className === 'font-style') return value === 'italic';
  return objects || NUMBER.test(value);
}

/** Whether a node sits in a `StyleSheet.create` or a `style` or `*Style` prop. */
function inStyle(node, sf) {
  for (let at = node.parent; at; at = at.parent) {
    if (ts.isJsxAttribute(at)) return /^(style|\w+Style)$/.test(keyName(at.name) ?? '');
    if (ts.isCallExpression(at) && /StyleSheet\.create$/.test(at.expression.getText(sf))) {
      return true;
    }
  }
  return false;
}

/** Whether an import specifier in `rel` names a module inside `src/theme` past its index. */
function deepThemeImport(rel, specifier) {
  const target = specifier.startsWith('@/')
    ? `src/${specifier.slice(2)}`
    : specifier.startsWith('.')
      ? posix.join(posix.dirname(rel), specifier)
      : null;
  return target !== null && target.startsWith('src/theme/') && target !== 'src/theme/index';
}

/**
 * Every site in one file where `className` takes a value written by hand, as
 * `{ line, text }`. The sites are what the guard counts.
 */
export function literalSites(sf, className) {
  const sites = [];
  const at = (node, text) =>
    sites.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text });
  const cls = STYLE_CLASSES.find((c) => c.name === className);
  if (!cls) throw new Error(`no style class named ${className}`);
  const keys = new Set(cls.keys);
  const skipOne = className === 'opacity' || className === 'alpha';

  const visit = (node) => {
    switch (className) {
      case 'icon-size':
        if (ts.isJsxAttribute(node) && keyName(node.name) === 'size') {
          for (const v of literals(attributeValue(node))) {
            if (/^-?[0-9.]+$/.test(v)) at(node, `size={${v}}`);
          }
        }
        break;
      case 'motion':
        // An object naming an easing is an animation config wherever it is
        // built, so its duration counts even outside a timing call.
        if (
          ts.isObjectLiteralExpression(node) &&
          !isAnimationConfigArgument(node) &&
          node.properties.some(
            (p) =>
              (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
              keyName(p.name) === 'easing'
          )
        ) {
          for (const p of node.properties) {
            const key = ts.isPropertyAssignment(p) ? keyName(p.name) : null;
            if (key !== 'duration' && key !== 'delay') continue;
            for (const v of literals(p.initializer)) at(p, `${key}: ${v}`);
          }
        }
        if (ts.isCallExpression(node)) {
          const name = calleeName(node);
          if (name && ANIMATION_CONFIG_CALLS.has(name)) {
            for (const arg of node.arguments) {
              const obj = unwrap(arg);
              if (!obj || !ts.isObjectLiteralExpression(obj)) continue;
              for (const p of obj.properties) {
                const key = ts.isPropertyAssignment(p) ? keyName(p.name) : null;
                if (key !== 'duration' && key !== 'delay') continue;
                for (const v of literals(p.initializer)) at(p, `${key}: ${v}`);
              }
            }
          }
          const cameraArity = name ? CAMERA_CALLS.get(name) : undefined;
          if (cameraArity && node.arguments.length === cameraArity) {
            for (const v of literals(node.arguments[cameraArity - 1])) {
              if (/^[0-9.]+$/.test(v)) at(node, `${name}(…, ${v})`);
            }
          }
          const callee = unwrap(node.expression);
          const memberTiming =
            ts.isPropertyAccessExpression(callee) &&
            (callee.name.text === 'duration' || callee.name.text === 'delay');
          const firstArgTiming =
            name === 'withDelay' ||
            (ts.isPropertyAccessExpression(callee) &&
              callee.name.text === 'create' &&
              callee.expression.getText(sf) === 'LayoutAnimation');
          if ((memberTiming || firstArgTiming) && node.arguments[0]) {
            for (const v of literals(node.arguments[0])) {
              if (/^[0-9.]+$/.test(v)) at(node, `${name}(${v})`);
            }
          }
        }
        break;
      case 'alpha':
        if (ts.isCallExpression(node) && calleeName(node) === 'colorWithOpacity') {
          for (const v of literals(node.arguments[1], { skipOne })) {
            at(node, `colorWithOpacity(…, ${v})`);
          }
        }
        // A two-digit hex alpha appended to an interpolated colour: `${c}33`.
        if (ts.isTemplateExpression(node)) {
          const tail = node.templateSpans[node.templateSpans.length - 1]?.literal.text ?? '';
          if (/^[0-9A-Fa-f]{2}$/.test(tail)) at(node, `\`\${…}${tail}\``);
        }
        break;
      case 'shadow':
        if (ts.isCallExpression(node) && calleeName(node) === 'createShadow') {
          for (const v of literals(node.arguments[0])) at(node, `createShadow(${v})`);
        }
        break;
      case 'container':
        if (
          ts.isCallExpression(node) &&
          /StyleSheet\.create$/.test(node.expression.getText(sf)) &&
          node.arguments[0] &&
          ts.isObjectLiteralExpression(unwrap(node.arguments[0]))
        ) {
          for (const p of unwrap(node.arguments[0]).properties) {
            const name = keyName(p.name);
            const style = ts.isPropertyAssignment(p) ? unwrap(p.initializer) : null;
            if (!name || !style || !ts.isObjectLiteralExpression(style)) continue;
            const kind = containerKind(name, style);
            if (kind) at(p, `${name}: a hand-built ${kind}`);
          }
        }
        break;
      case 'theme-import':
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          deepThemeImport(sf.fileName, node.moduleSpecifier.text)
        ) {
          at(node, `from '${node.moduleSpecifier.text}'`);
        }
        break;
      default:
        break;
    }

    if (keys.size > 0 && className !== 'icon-size') {
      if (className === 'border-width') {
        const key =
          ts.isPropertyAssignment(node) || ts.isJsxAttribute(node) ? keyName(node.name) : null;
        if (key && keys.has(key)) {
          const value = ts.isJsxAttribute(node) ? attributeValue(node) : node.initializer;
          for (const v of nonStrokeWidths(value, sf)) at(node, `${key}: ${v}`);
        }
      } else if (ts.isPropertyAssignment(node) && keys.has(keyName(node.name))) {
        const key = keyName(node.name);
        const objects = key === 'shadowOffset';
        // `elevation` is also the climb of a ride, in data objects everywhere;
        // only a style's elevation is a shadow.
        const counted = className !== 'motion' && (key !== 'elevation' || inStyle(node, sf));
        if (counted) {
          for (const v of literals(node.initializer, { skipOne, objects })) {
            if (accepts(className, v, objects)) at(node, `${key}: ${v}`);
          }
        }
      }
      if (
        ts.isJsxAttribute(node) &&
        keys.has(keyName(node.name)) &&
        className !== 'motion' &&
        className !== 'border-width' &&
        className !== 'colour'
      ) {
        for (const v of literals(attributeValue(node), { skipOne })) {
          if (accepts(className, v, false)) at(node, `${keyName(node.name)}={${v}}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

/**
 * The weights a static font file has no face for, by the number or the name
 * React Native takes for it. A 500 resolves to 400 or 600 depending on the
 * platform, so the same text draws two weights, and the scale draws nothing
 * above 700.
 */
const OFF_SCALE_WEIGHTS = new Map([
  ['500', '500'],
  ['medium', '500'],
  ['800', '800'],
  ['heavy', '800'],
  ['900', '900'],
  ['black', '900'],
]);

/** Every font weight off the scale's 400, 600 and 700, anywhere under `src/` including the theme. */
export function offScaleWeightSites(sf) {
  const sites = [];
  const visit = (node) => {
    const key =
      ts.isPropertyAssignment(node) || ts.isJsxAttribute(node) ? keyName(node.name) : null;
    if (key === 'fontWeight') {
      const value = ts.isJsxAttribute(node) ? attributeValue(node) : node.initializer;
      for (const v of literals(value)) {
        const weight = OFF_SCALE_WEIGHTS.get(String(v));
        if (weight) {
          sites.push({
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            text: `fontWeight: ${weight}`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

function styleObjectKeys(expr, out) {
  const value = unwrap(expr);
  if (!value) return;
  if (ts.isObjectLiteralExpression(value)) {
    for (const p of value.properties) {
      if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) {
        const key = keyName(p.name);
        if (key) out.push({ key, node: p });
      }
    }
  } else if (ts.isArrayLiteralExpression(value)) {
    for (const e of value.elements) styleObjectKeys(e, out);
  } else if (ts.isConditionalExpression(value)) {
    styleObjectKeys(value.whenTrue, out);
    styleObjectKeys(value.whenFalse, out);
  } else if (ts.isBinaryExpression(value)) {
    styleObjectKeys(value.left, out);
    styleObjectKeys(value.right, out);
  }
}

/**
 * Every style key one file sets, as `{ key, line }`: the keys of each entry in
 * a `StyleSheet.create` and of each object written into a `style` prop or a
 * `*Style` prop.
 */
export function styleKeys(sf) {
  const found = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      /StyleSheet\.create$/.test(node.expression.getText(sf)) &&
      node.arguments[0]
    ) {
      const sheet = unwrap(node.arguments[0]);
      if (ts.isObjectLiteralExpression(sheet)) {
        for (const p of sheet.properties) {
          if (ts.isPropertyAssignment(p)) styleObjectKeys(p.initializer, found);
        }
      }
    }
    if (
      ts.isJsxAttribute(node) &&
      /^(style|\w+Style)$/.test(keyName(node.name) ?? '') &&
      node.initializer &&
      ts.isJsxExpression(node.initializer)
    ) {
      styleObjectKeys(node.initializer.expression, found);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found.map(({ key, node }) => ({
    key,
    line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
  }));
}
