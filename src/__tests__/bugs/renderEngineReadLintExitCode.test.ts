/**
 * Scenario: the render-time engine read lint runs in `npm run audit`.
 *
 * Expected behaviour: an engine call in a hook or component body fails, one
 * behind a deferring boundary passes, one inside useMemo or a lazy useState
 * initialiser is reported but passes, and a loop variable that happens to be
 * called `engine` is not a read. A clean checkout exits 0, or the gate costs
 * every commit a `--no-verify`.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-render-engine-reads.mjs');

function runLint(root?: string, ...flags: string[]): { status: number; output: string } {
  const args = root ? [SCRIPT, '--root', root, ...flags] : [SCRIPT, ...flags];
  try {
    const output = execFileSync('node', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const IMPORTS =
  "import { useEffect, useMemo, useState, useCallback } from 'react';\nimport { useQuery } from '@tanstack/react-query';\nimport { getEngine } from '@/shared/native/engine';\n";

describe('render-time engine read lint', () => {
  const roots: string[] = [];

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  const withHook = (body: string, path = 'src/features/x/hooks/useThing.ts') => {
    const root = mkdtempSync(join(tmpdir(), 'render-reads-'));
    roots.push(root);
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, `${IMPORTS}${body}`);
    return root;
  };

  /** Two files: the hook, and the module it takes a helper from. */
  const withModules = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), 'render-reads-'));
    roots.push(root);
    for (const [path, body] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, body);
    }
    return root;
  };

  it('fails a read in the hook body', () => {
    const root = withHook('export function useThing() {\n  return getEngine()?.getStats();\n}\n');
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('useThing.ts:5  useThing  engine.getStats');
  });

  it('fails a read through a const bound to the engine', () => {
    const root = withHook(
      'export function useThing() {\n  const engine = getEngine();\n  const n = engine?.getActivityCount() ?? 0;\n  return n;\n}\n'
    );
    expect(runLint(root).status).toBe(1);
  });

  it('fails a read in a component, and one reached through a local helper', () => {
    const root = withHook(
      'function readCount() {\n  const engine = getEngine();\n  return engine ? engine.getActivityCount() : 0;\n}\nexport function Thing() {\n  const count = readCount();\n  return count;\n}\n',
      'src/features/x/components/Thing.tsx'
    );
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('Thing.tsx:9  Thing  engine.getActivityCount  via readCount:6');
  });

  it('fails a bare engine argument to a hook, which is evaluated every render', () => {
    const root = withHook(
      'export function useThing() {\n  const [n] = useState(getEngine()?.getActivityCount() ?? 0);\n  return n;\n}\n'
    );
    expect(runLint(root).status).toBe(1);
  });

  it('fails a read through a const bound from useEngineReady, which returns the same handle', () => {
    const root = withHook(
      [
        "import { useEngineReady } from '@/shared/native/useEngineReady';",
        'export function Row() {',
        '  const engine = useEngineReady();',
        "  const radius = Number(engine?.getSetting?.('radius') ?? '0');",
        '  return radius;',
        '}',
        '',
      ].join('\n'),
      'src/features/x/components/Row.tsx'
    );
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('Row.tsx:7  Row  engine.getSetting');
  });

  it('passes a useEngineReady handle read only inside an effect', () => {
    const root = withHook(
      [
        "import { useEngineReady } from '@/shared/native/useEngineReady';",
        'export function useThing() {',
        '  const engine = useEngineReady();',
        '  const [n, setN] = useState(0);',
        '  useEffect(() => { setN(engine?.getActivityCount() ?? 0); }, [engine]);',
        '  return n;',
        '}',
        '',
      ].join('\n')
    );
    expect(runLint(root).status).toBe(0);
  });

  it('passes a read inside a queryFn, a useEffect, a useCallback and an event handler', () => {
    const root = withHook(
      [
        'export function useThing(id: string) {',
        '  const [n, setN] = useState(0);',
        '  useEffect(() => { setN(getEngine()?.getActivityCount() ?? 0); }, []);',
        '  const refresh = useCallback(() => getEngine()?.getStats(), []);',
        '  const onPress = () => { const engine = getEngine(); engine?.triggerRefresh("activities"); };',
        '  useQuery({ queryKey: ["x", id], queryFn: () => getEngine()?.getIntervalBody(id) ?? null });',
        '  return { n, refresh, onPress };',
        '}',
        '',
      ].join('\n')
    );
    const { status, output } = runLint(root);
    expect(status).toBe(0);
    expect(output).toContain('render-time reads: 0');
  });

  it('reports a useMemo read and a lazy initialiser without failing', () => {
    const root = withHook(
      [
        'export function useThing(trigger: number) {',
        '  const [first] = useState(() => getEngine()?.getActivityCount() ?? 0);',
        '  const stats = useMemo(() => getEngine()?.getStats(), [trigger]);',
        '  return { first, stats };',
        '}',
        '',
      ].join('\n')
    );
    const { status, output } = runLint(root, '--verbose');
    expect(status).toBe(0);
    expect(output).toContain('useThing.ts:6  useThing  engine.getStats  deps [trigger]');
    expect(output).toContain('useThing.ts:5  useThing  engine.getActivityCount');
    expect(output).toContain('memo reads: 1, unkeyed memo reads: 0, initialiser reads: 1');
  });

  it('fails a useMemo read keyed only on a bare useEngineSubscription trigger', () => {
    const root = withHook(
      [
        "import { useEngineSubscription } from '@/shared/native/useEngineSubscription';",
        'export function useThing() {',
        "  const trigger = useEngineSubscription(['activities']);",
        '  return useMemo(() => getEngine()?.getStats(), [trigger]);',
        '}',
        '',
      ].join('\n')
    );
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('useThing.ts:7  useThing  engine.getStats  deps [trigger]');
    expect(output).toContain('useEngineRead');
  });

  it('fails a bare-trigger memo whose other deps are inputs, whatever the trigger is called', () => {
    const root = withHook(
      [
        "import { useEngineSubscription } from '@/shared/native/useEngineSubscription';",
        'export function useThing(id: string) {',
        "  const sectionsTick = useEngineSubscription(['sections']);",
        '  return useMemo(() => getEngine()?.getSectionById(id), [id, sectionsTick]);',
        '}',
        '',
      ].join('\n')
    );
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('useEngineRead');
  });

  it('fails a bare-trigger memo whose other key is a precomputed fallback', () => {
    const root = withHook(
      [
        "import { useEngineSubscription } from '@/shared/native/useEngineSubscription';",
        'export function useThing(ids: string[], preComputedBundle?: number[]) {',
        "  const trigger = useEngineSubscription(['sections']);",
        '  return useMemo(',
        '    () => preComputedBundle ?? getEngine()?.getActivityHighlightsBundle(ids),',
        '    [ids, trigger, preComputedBundle]',
        '  );',
        '}',
        '',
      ].join('\n')
    );
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('useEngineRead');
  });

  it('fails a bare-trigger memo that reaches the engine through a helper', () => {
    const root = withHook(
      [
        "import { useEngineSubscription } from '@/shared/native/useEngineSubscription';",
        'function readStats() {',
        '  return getEngine()?.getStats();',
        '}',
        'export function useThing() {',
        "  const trigger = useEngineSubscription(['activities']);",
        '  return useMemo(() => readStats(), [trigger]);',
        '}',
        '',
      ].join('\n')
    );
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('useEngineRead');
  });

  it('passes a memo keyed on the reader useEngineRead hands back', () => {
    const root = withHook(
      [
        "import { useEngineRead } from '@/shared/native/useEngineSubscription';",
        'export function useThing(id: string) {',
        "  const readSections = useEngineRead(['sections']);",
        '  const direct = useMemo(() => {',
        '    void readSections;',
        '    return getEngine()?.getSectionById(id);',
        '  }, [id, readSections]);',
        '  const through = useMemo(',
        '    () => readSections((engine) => engine.getExcludedRouteActivityIds(id)),',
        '    [id, readSections]',
        '  );',
        '  return { direct, through };',
        '}',
        '',
      ].join('\n')
    );
    const { status, output } = runLint(root, '--verbose');
    expect(status).toBe(0);
    expect(output).toContain('useThing.ts:9  useThing  engine.getSectionById');
  });

  it('leaves a caller key alone even when it shares a name with a trigger', () => {
    const root = withHook(
      [
        'export function useThing(refreshKey: number, tick: number) {',
        '  return useMemo(() => getEngine()?.getStats(), [refreshKey, tick]);',
        '}',
        '',
      ].join('\n')
    );
    expect(runLint(root).status).toBe(0);
  });

  it('fails a useMemo read keyed on its inputs alone, which nothing re-runs', () => {
    const root = withHook(
      [
        'export function useThing(id: string) {',
        '  return useMemo(() => getEngine()?.getSectionById(id), [id]);',
        '}',
        '',
      ].join('\n')
    );
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('useThing.ts:5  useThing  engine.getSectionById  deps [id]');
  });

  it('fails a useMemo read with no dependency array at all', () => {
    const root = withHook(
      'export function useThing() {\n  return useMemo(() => getEngine()?.getStats());\n}\n'
    );
    expect(runLint(root).status).toBe(1);
  });

  it('fails a useMemo read keyed on an empty array', () => {
    const root = withHook(
      'export function useThing() {\n  return useMemo(() => getEngine()?.getRetiredSections(), []);\n}\n'
    );
    expect(runLint(root).status).toBe(1);
  });

  it('passes a useMemo read whose deps carry a precomputed value', () => {
    const root = withHook(
      [
        'export function useThing(preComputedActivityCount?: number) {',
        '  return useMemo(',
        '    () => preComputedActivityCount ?? getEngine()?.getActivityCount() ?? 0,',
        '    [preComputedActivityCount]',
        '  );',
        '}',
        '',
      ].join('\n')
    );
    expect(runLint(root).status).toBe(0);
  });

  it('passes a useMemo read keyed on a precomputed value hoisted out of its wrapper', () => {
    // Scenario: a screen bundle is hoisted into a local so the memo keys on the
    // bundle's own array rather than the wrapper literal the screen rebuilds.
    // Expected behaviour: the hoisted local is still a precomputed value.
    const root = withHook(
      [
        'export function useThing(preComputed?: { metrics: number[] }) {',
        '  const bundledMetrics = preComputed?.metrics;',
        '  return useMemo(',
        '    () => bundledMetrics ?? getEngine()?.getActivityMetrics() ?? [],',
        '    [bundledMetrics]',
        '  );',
        '}',
        '',
      ].join('\n')
    );
    expect(runLint(root).status).toBe(0);
  });

  it('ignores a loop variable or field that is merely called engine', () => {
    const root = withHook(
      [
        'export function useThing(engines: { id: string }[]) {',
        '  return useMemo(() => {',
        '    const out: string[] = [];',
        '    for (const engine of engines) out.push(engine.id.toUpperCase());',
        '    return out;',
        '  }, [engines]);',
        '}',
        'export function Plain() {',
        '  const ids: string[] = [];',
        '  for (const engine of [{ id: "a" }]) ids.push(engine.id.trim());',
        '  return ids;',
        '}',
        '',
      ].join('\n')
    );
    const { status, output } = runLint(root, '--verbose');
    expect(status).toBe(0);
    expect(output).toContain('memo reads: 0');
  });

  it('ignores a plain function that is neither a hook nor a component', () => {
    const root = withHook(
      'export function readCount() {\n  return getEngine()?.getActivityCount() ?? 0;\n}\n',
      'src/features/x/lib/read.ts'
    );
    expect(runLint(root).status).toBe(0);
  });

  it('fails a read reached through a helper imported by alias', () => {
    const root = withModules({
      'src/features/x/lib/read.ts':
        "import { getEngine } from '@/shared/native/engine';\n" +
        'export function readBody(id: string) {\n' +
        '  return getEngine()?.getStreamBody(id) ?? null;\n' +
        '}\n',
      'src/features/x/hooks/useThing.ts':
        "import { readBody } from '@/features/x/lib/read';\n" +
        'export function useThing(id: string) {\n' +
        '  return readBody(id) !== null;\n' +
        '}\n',
    });
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('useThing.ts:3  useThing  engine.getStreamBody  via readBody:3');
  });

  it('follows a relative import and one through a barrel', () => {
    const root = withModules({
      'src/features/x/lib/read.ts':
        "import { getEngine } from '@/shared/native/engine';\n" +
        'export function readBody(id: string) {\n' +
        '  return getEngine()?.getStreamBody(id) ?? null;\n' +
        '}\n',
      'src/features/x/lib/index.ts': "export { readBody } from './read';\n",
      'src/features/x/hooks/useNear.ts':
        "import { readBody } from '../lib/read';\n" +
        'export function useNear(id: string) {\n  return readBody(id);\n}\n',
      'src/features/x/hooks/useBarrel.ts':
        "import { readBody } from '@/features/x/lib';\n" +
        'export function useBarrel(id: string) {\n  return readBody(id);\n}\n',
    });
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('useNear.ts:3  useNear  engine.getStreamBody');
    expect(output).toContain('useBarrel.ts:3  useBarrel  engine.getStreamBody');
  });

  it('passes an imported helper called from inside a queryFn', () => {
    const root = withModules({
      'src/features/x/lib/read.ts':
        "import { getEngine } from '@/shared/native/engine';\n" +
        'export function readBody(id: string) {\n' +
        '  return getEngine()?.getStreamBody(id) ?? null;\n' +
        '}\n',
      'src/features/x/hooks/useThing.ts':
        "import { useQuery } from '@tanstack/react-query';\n" +
        "import { readBody } from '@/features/x/lib/read';\n" +
        'export function useThing(id: string) {\n' +
        '  return useQuery({ queryKey: ["x", id], queryFn: () => readBody(id) });\n' +
        '}\n',
    });
    const { status, output } = runLint(root);
    expect(status).toBe(0);
    expect(output).toContain('render-time reads: 0');
  });

  it('does not follow an imported helper whose own read is deferred', () => {
    const root = withModules({
      'src/features/x/lib/read.ts':
        "import { getEngine } from '@/shared/native/engine';\n" +
        'export function subscribe(fn: () => void) {\n' +
        '  setTimeout(() => { getEngine()?.getStats(); fn(); }, 0);\n' +
        '}\n',
      'src/features/x/hooks/useThing.ts':
        "import { subscribe } from '@/features/x/lib/read';\n" +
        'export function useThing() {\n  return subscribe(() => {});\n}\n',
    });
    expect(runLint(root).status).toBe(0);
  });

  it.each([
    ['imported from veloqrs', "import { engine } from 'veloqrs';\n", 'engine'],
    [
      'imported from veloqrs under another name',
      "import { engine as client } from 'veloqrs';\n",
      'client',
    ],
  ])('fails a read through the engine %s', (_form, imports, name) => {
    const root = withModules({
      'src/features/x/components/Stats.tsx': `${imports}export function Stats() {\n  const stats = ${name}.getStats();\n  return stats;\n}\n`,
    });
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('Stats.tsx:3  Stats  engine.getStats');
  });

  it.each([
    ['a namespace import', "import * as V from 'veloqrs';\n", 'V.engine.getStats()'],
    ['a variable holding the require', "const v = require('veloqrs');\n", 'v.engine.getStats()'],
    ['an inline require', '', "require('veloqrs').engine.getStats()"],
    [
      'a require destructure',
      "const { engine: client } = require('veloqrs');\n",
      'client.getStats()',
    ],
    [
      'the EngineClient instance',
      "import { EngineClient } from 'veloqrs';\n",
      'EngineClient.getInstance().getStats()',
    ],
    [
      'a handle bound from the EngineClient instance',
      "import { EngineClient } from 'veloqrs';\nconst held = EngineClient.getInstance();\n",
      'held.getStats()',
    ],
    [
      'the shared module imported by a relative path',
      "import { getEngine } from '../../../shared/native/engine';\n",
      'getEngine()?.getStats()',
    ],
  ])('fails a render read through %s', (_form, imports, call) => {
    const root = withModules({
      'src/features/x/components/Stats.tsx': `${imports}export function Stats() {\n  const stats = ${call};\n  return stats;\n}\n`,
    });
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('Stats.tsx');
  });

  it('passes the engine imported from veloqrs when it is read only inside an effect', () => {
    const root = withModules({
      'src/features/x/components/Stats.tsx':
        "import { useEffect } from 'react';\nimport { engine } from 'veloqrs';\nexport function Stats() {\n  useEffect(() => {\n    engine.getStats();\n  }, []);\n  return null;\n}\n",
    });
    expect(runLint(root).status).toBe(0);
  });

  it.each([
    ['a useMemo', 'const client = useMemo(() => getEngine(), []);'],
    [
      'a useMemo with a block body',
      'const client = useMemo(() => {\n    return getEngine();\n  }, []);',
    ],
    ['a useRef', 'const client = useRef(getEngine()).current;'],
    ['a useState initialiser', 'const [client] = useState(() => getEngine());'],
  ])('fails a render read through a handle held in %s', (_form, binding) => {
    const root = withHook(
      `import { useRef } from 'react';\nexport function useThing() {\n  ${binding}\n  return client?.getStats();\n}\n`
    );
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('useThing  engine.getStats');
  });

  it('fails a memo keyed on a handle held in a useMemo, which nothing re-runs after a sync', () => {
    const root = withHook(
      'export function useThing() {\n  const client = useMemo(() => getEngine(), []);\n  return useMemo(() => client?.sectionDetectionAwaiting() ?? null, [client]);\n}\n'
    );
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('useMemo that nothing re-runs');
    expect(output).toContain('engine.sectionDetectionAwaiting');
  });

  it('does not take a memo holding a read for a handle', () => {
    const root = withHook(
      'export function useThing(refreshKey: number) {\n  const stats = useMemo(() => getEngine()?.getStats(), [refreshKey]);\n  return stats?.summary.toString();\n}\n'
    );
    const { status, output } = runLint(root, '--verbose');
    expect(status).toBe(0);
    expect(output).not.toContain('engine.toString');
  });

  it('fails on a stale allowlist entry so the list never outlives the debt', () => {
    // A file the real allowlist names, present but without the read it excuses.
    const root = withHook(
      'export function useThing() {\n  return 1;\n}\n',
      'src/features/settings/components/StreamHistoryRow.tsx'
    );
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('Stale ALLOWLIST');
  });
});
