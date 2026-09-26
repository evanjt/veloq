/**
 * Scenario: a rename moves a `testID` and no flow is touched. The flow then
 * fails at the step that names the old id, and every step after it never runs,
 * so the flow quietly stops checking the thing it exists for. One flow sat
 * that way for eight days.
 *
 * Expected behaviour: the guard resolves every id a flow asserts against the
 * ids the tree renders, including the templated ones, and names the flows that
 * assert an id nothing renders.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-maestro-ids.mjs');

/** A throwaway tree with one component file and one flow. */
function treeWith(component: string, flow: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-maestro-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, '.maestro'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/Thing.tsx'), component);
  fs.writeFileSync(path.join(root, '.maestro/flow.yaml'), flow);
  return root;
}

function runGuard(root: string, baseline: string[] = []) {
  const baselineFile = path.join(root, 'baseline.json');
  fs.writeFileSync(baselineFile, JSON.stringify({ unresolved: baseline }));
  try {
    const out = execFileSync('node', [GUARD, '--root', root, '--baseline', baselineFile], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** Whether the guard resolves `id` against a tree rendering `component`. */
function resolves(component: string, id: string): boolean {
  const root = treeWith(component, `- assertVisible:\n    id: "${id}"\n`);
  return runGuard(root).code === 0;
}

describe('resolving a flow id against the tree', () => {
  it('takes a literal the tree renders', () => {
    expect(resolves('<View testID="routes-list" />', 'routes-list')).toBe(true);
  });

  it('does not take a literal the tree does not render', () => {
    expect(resolves('<View testID="routes-list" />', 'routes-lists')).toBe(false);
    expect(resolves('<View testID="routes-list" />', 'routes')).toBe(false);
  });

  it('takes a templated id, whatever the interpolation turns out to be', () => {
    const periods = '<View testID={`strength-period-${p.id}`} />';

    expect(resolves(periods, 'strength-period-7d')).toBe(true);
    expect(resolves(periods, 'strength-period-6m')).toBe(true);
  });

  it('keeps a template from resolving an id it cannot produce', () => {
    // The literal parts have to match, or the template for `-distance` would
    // resolve `-duration` and a renamed row would go unnoticed.
    const card = '<View testID={`activity-card-${id}-distance`} />';

    expect(resolves(card, 'activity-card-a1-distance')).toBe(true);
    expect(resolves(card, 'activity-card-a1-duration')).toBe(false);
  });

  it('refuses a template with no literal of its own to anchor on', () => {
    // `${testID}-${id}` is a component composing an id its parent passed in. As
    // a pattern it matches nearly every id in the tree, so taking it would
    // resolve the wrong ids as readily as the right ones. The honest answer is
    // that it cannot be read from here.
    expect(resolves('<View testID={`${testID}-${id}`} />', 'anything-at-all')).toBe(false);
  });

  it('takes both sides of an id chosen by a ternary', () => {
    const list = '<View testID={rows.length > 0 ? "sections-list" : "sections-list-empty"} />';

    expect(resolves(list, 'sections-list')).toBe(true);
    expect(resolves(list, 'sections-list-empty')).toBe(true);
  });

  it('takes an id built by concatenation', () => {
    expect(resolves("<View testID={'route-row-' + index} />", 'route-row-')).toBe(true);
  });

  it('takes an id handed down through a prop that is not called testID', () => {
    const screen = '<Screen containerTestID="activity-detail-content" />';

    expect(resolves(screen, 'activity-detail-content')).toBe(true);
  });
});

describe('the guard over a tree', () => {
  it('passes when every asserted id resolves', () => {
    const root = treeWith(
      '<View testID="routes-list" />',
      '- assertVisible:\n    id: "routes-list"\n'
    );

    expect(runGuard(root).code).toBe(0);
  });

  it('fails on an id nothing renders, and names the flow that asserts it', () => {
    const root = treeWith(
      '<View testID="routes-list" />',
      '- assertVisible:\n    id: "routes-lst"\n'
    );

    const result = runGuard(root);

    expect(result.code).not.toBe(0);
    expect(result.out).toContain('routes-lst');
    expect(result.out).toContain('flow.yaml');
  });

  it('passes an unresolved id the baseline already lists', () => {
    const root = treeWith(
      '<View testID="routes-list" />',
      '- assertVisible:\n    id: "routes-lst"\n'
    );

    expect(runGuard(root, ['routes-lst']).code).toBe(0);
  });

  it('fails a baseline entry the tree has already beaten, so ground is not given back', () => {
    const root = treeWith(
      '<View testID="routes-list" />',
      '- assertVisible:\n    id: "routes-list"\n'
    );

    const result = runGuard(root, ['routes-list']);

    expect(result.code).not.toBe(0);
    expect(result.out).toMatch(/delete/i);
  });
});
