/**
 * Scenario: a worklet runs on the UI runtime from the code string the worklets
 * plugin writes, which binds the names it captured from `this.__closure` at the
 * top of its body. A parameter default is evaluated before the body runs, so a
 * default that names a captured constant throws a ReferenceError there, and the
 * throw on the UI thread kills a release build. Jest otherwise runs a worklet as
 * plain JavaScript, where the module scope is still in reach and it passes.
 *
 * Expected behaviour: every worklet in the app runs from its UI-runtime code.
 */
import { transformSync, parseSync, traverse, types as t } from '@babel/core';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BACK_SWIPE_EDGE_WIDTH, startsInBackSwipeEdge } from '@/shared/ui/backSwipeEdge';
import { PAGER_ACTIVATION_OFFSET } from '@/shared/ui/pagerPanDecision';

const root = join(__dirname, '..', '..', '..');

/** The UI-runtime code of each worklet in `file`, keyed by the worklet's name. */
function uiRuntimeCode(file: string): Map<string, string> {
  const source = readFileSync(join(root, file), 'utf8');
  const out = transformSync(source, {
    filename: join(root, file),
    babelrc: false,
    configFile: false,
    presets: [['@babel/preset-typescript', { isTSX: file.endsWith('.tsx'), allExtensions: true }]],
    plugins: ['react-native-worklets/plugin'],
  });
  const codes = new Map<string, string>();
  const ast = parseSync(out!.code!, {
    filename: 'out.tsx',
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['jsx'] },
  });
  traverse(ast!, {
    VariableDeclarator(path) {
      const { id, init } = path.node;
      if (!t.isIdentifier(id) || !id.name.endsWith('_init_data')) return;
      if (!t.isObjectExpression(init)) return;
      for (const prop of init.properties) {
        if (
          t.isObjectProperty(prop) &&
          t.isIdentifier(prop.key, { name: 'code' }) &&
          t.isStringLiteral(prop.value)
        ) {
          const name = /^\(?function (\w+)/.exec(prop.value.value)?.[1] ?? id.name;
          codes.set(name, prop.value.value);
        }
      }
    },
  });
  return codes;
}

/** The worklet function in its UI-runtime code. */
function workletFunction(code: string): t.FunctionExpression {
  const ast = parseSync(`(${code})`, { babelrc: false, configFile: false });
  return (ast!.program.body[0] as t.ExpressionStatement).expression as t.FunctionExpression;
}

/**
 * The names the body binds from `this.__closure`, in the order it binds them, and whether it
 * takes them by position, which the plugin writes as an array pattern, or by name.
 */
function closureBindings(fn: t.FunctionExpression): { names: string[]; positional: boolean } {
  const first = fn.body.body[0];
  if (
    !t.isVariableDeclaration(first) ||
    !t.isMemberExpression(first.declarations[0]?.init) ||
    !t.isIdentifier((first.declarations[0].init as t.MemberExpression).property, {
      name: '__closure',
    })
  ) {
    return { names: [], positional: false };
  }
  const pattern = first.declarations[0].id;
  if (t.isArrayPattern(pattern)) {
    return {
      names: pattern.elements.flatMap((element) => (t.isIdentifier(element) ? [element.name] : [])),
      positional: true,
    };
  }
  if (t.isObjectPattern(pattern)) {
    return {
      names: pattern.properties.flatMap((prop) =>
        t.isObjectProperty(prop) && t.isIdentifier(prop.key) ? [prop.key.name] : []
      ),
      positional: false,
    };
  }
  return { names: [], positional: false };
}

/** Builds a worklet from its UI-runtime code with the closure the plugin would hand it. */
function onUiRuntime<A extends unknown[], R>(
  code: string,
  closure: Record<string, unknown>
): (...args: A) => R {
  const { names, positional } = closureBindings(workletFunction(code));
  const bound = positional ? names.map((name) => closure[name]) : closure;
  const fn = new Function(`return (${code});`)() as (...args: A) => R;
  return (...args: A) => fn.apply({ __closure: bound }, args);
}

/** Names a worklet's parameters read that only its body binds from the closure. */
function closureNamesReadByParameters(code: string): string[] {
  const fn = workletFunction(code);
  const captured = new Set(closureBindings(fn).names);
  const read = new Set<string>();
  const visit = (node: t.Node | null | undefined): void => {
    if (!node || typeof node !== 'object') return;
    if (t.isIdentifier(node) && captured.has(node.name)) read.add(node.name);
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const child = (node as unknown as Record<string, unknown>)[key];
      for (const c of Array.isArray(child) ? child : [child]) visit(c as t.Node);
    }
  };
  for (const param of fn.params) visit(param);
  return [...read];
}

function filesWithWorklets(): string[] {
  return readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' })
    .map((f) => join('src', f))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__'))
    .filter((f) => readFileSync(join(root, f), 'utf8').includes("'worklet'"));
}

describe('worklets on the UI runtime', () => {
  it('decides a tab pager pan without reaching module scope', () => {
    const code = uiRuntimeCode('src/shared/ui/pagerPanDecision.ts').get(
      'pagerPanDecision_pagerPanDecisionTs1'
    );
    expect(code).toBeDefined();
    const decide = onUiRuntime<[object], string>(code!, {
      BACK_SWIPE_EDGE_WIDTH,
      startsInBackSwipeEdge,
      PAGER_ACTIVATION_OFFSET,
    });
    const pan = { index: 1, tabCount: 3, translationX: -40, screenWidth: 400, isRTL: false };
    expect(decide({ ...pan, startX: 200 })).toBe('activate');
    expect(decide({ ...pan, startX: BACK_SWIPE_EDGE_WIDTH - 1 })).toBe('fail');
  });

  it('decides a chart scrub pan without reaching module scope', () => {
    const code = uiRuntimeCode('src/shared/charts/scrubPanDecision.ts').get(
      'scrubPanDecision_scrubPanDecisionTs1'
    );
    expect(code).toBeDefined();
    const decide = onUiRuntime<[object], string>(code!, { startsInBackSwipeEdge });
    const pan = { startX: 200, screenWidth: 400, isRTL: false, slop: 8 };
    expect(decide({ ...pan, translationX: 9, translationY: 2 })).toBe('activate');
    expect(decide({ ...pan, translationX: 2, translationY: 9 })).toBe('fail');
    expect(
      decide({ ...pan, startX: BACK_SWIPE_EDGE_WIDTH - 1, translationX: 9, translationY: 0 })
    ).toBe('fail');
  });

  it('tests a touch against the back-swipe strip without reaching module scope', () => {
    const code = uiRuntimeCode('src/shared/ui/backSwipeEdge.ts').get(
      'startsInBackSwipeEdge_backSwipeEdgeTs1'
    );
    expect(code).toBeDefined();
    const starts = onUiRuntime<[number, number, boolean], boolean>(code!, {
      BACK_SWIPE_EDGE_WIDTH,
    });
    expect(starts(BACK_SWIPE_EDGE_WIDTH - 1, 400, false)).toBe(true);
    expect(starts(BACK_SWIPE_EDGE_WIDTH, 400, false)).toBe(false);
    expect(starts(400 - BACK_SWIPE_EDGE_WIDTH + 1, 400, true)).toBe(true);
  });

  it('gives no worklet a parameter default that reads a captured name', () => {
    const offenders: string[] = [];
    for (const file of filesWithWorklets()) {
      for (const [name, code] of uiRuntimeCode(file)) {
        for (const read of closureNamesReadByParameters(code)) {
          offenders.push(`${file}: ${name} defaults a parameter to ${read}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
