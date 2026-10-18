/**
 * Scenario: a row inside a map sheet card pushes the detail screen of its subject rather than a
 * card into the same sheet, which opens a second screen and a second sheet stacked over the
 * first.
 *
 * Expected behaviour: the guard refuses a detail push in any file the card registry reaches, by
 * name through a barrel as much as by path, names the file and line, and passes the helper's own
 * call, a file the registry does not reach, a push that is not a detail route and a type-only
 * import.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const script = join(__dirname, '../../../scripts/lint-sheet-card-navigation.mjs');
const REGISTRY = 'src/features/routes/screens/DetailCardStack.tsx';
const BARREL = 'src/features/routes/components/index.ts';

function check(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'sheet-card-navigation-'));
  for (const [rel, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), source);
  }
  try {
    execFileSync('node', [script, '--root', root], { stdio: ['ignore', 'pipe', 'pipe'] });
    return { failed: false, output: '' };
  } catch (error) {
    const failure = error as { stderr?: Buffer };
    return { failed: true, output: failure.stderr?.toString() ?? '' };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const registry = [
  "import { PlumCard } from './PlumCard';",
  'export const DETAIL_CARDS = { route: PlumCard };',
  '',
].join('\n');

const plumCard = [
  "import { DamsonRow } from '../components';",
  'export function PlumCard() {',
  '  return DamsonRow();',
  '}',
  '',
].join('\n');

const barrel = [
  "export { DamsonRow } from './DamsonRow';",
  "export * from './orchard';",
  "export { GreengageList } from './GreengageList';",
  '',
].join('\n');

/** A row the card reaches through the barrel, opening an activity the way `call` writes it. */
function damsonRow(call: string) {
  return [
    "import { navigateTo } from '@/shared/app/navigation';",
    "import { useOpenDetail } from '@/shared/app/MapSheetCards';",
    'export function DamsonRow() {',
    '  const openDetail = useOpenDetail();',
    `  return () => ${call};`,
    '}',
    '',
  ].join('\n');
}

const helper = [
  "import { navigateTo } from './navigation';",
  'export function useOpenDetail() {',
  '  return (subject: { kind: string; id: string }) => navigateTo(detailHref(subject));',
  '}',
  'function detailHref(subject: { kind: string; id: string }) {',
  '  return { pathname: `/${subject.kind}/[id]`, params: { id: subject.id } };',
  '}',
  '',
].join('\n');

const navigation = 'export function navigateTo(path: unknown) {}\n';

function tree(call: string, extra: Record<string, string> = {}) {
  return {
    [REGISTRY]: registry,
    'src/features/routes/screens/PlumCard.tsx': plumCard,
    [BARREL]: barrel,
    'src/features/routes/components/DamsonRow.tsx': damsonRow(call),
    'src/features/routes/components/orchard.ts': 'export const ORCHARD = 1;\n',
    'src/features/routes/components/GreengageList.tsx': [
      "import { navigateTo } from '@/shared/app/navigation';",
      "export function GreengageList() { return () => navigateTo('/route/r_greengage'); }",
      '',
    ].join('\n'),
    'src/shared/app/MapSheetCards.tsx': helper,
    'src/shared/app/navigation.ts': navigation,
    ...extra,
  };
}

it('passes a row that opens its subject through the helper', () => {
  expect(check(tree("openDetail({ kind: 'activity', id: 'a_plum' })"))).toEqual({
    failed: false,
    output: '',
  });
});

it('refuses a row under a card that pushes an activity screen, naming the file and line', () => {
  const result = check(tree("navigateTo('/activity/a_plum')"));

  expect(result.failed).toBe(true);
  expect(result.output).toContain(
    'src/features/routes/components/DamsonRow.tsx:5: navigateTo to /activity/a_plum'
  );
});

it.each([
  ['a template', 'navigateTo(`/section/${"s_quince"}`)'],
  ['an object pathname', "navigateTo({ pathname: '/section/history/[id]', params: { id: 's' } })"],
  ['the laps of a section', "navigateTo({ pathname: '/section/laps/[id]' })"],
  ['a router push', "router.push('/route/r_damson')"],
])('refuses a detail push written as %s', (_form, call) => {
  const result = check(tree(call));

  expect(result.failed).toBe(true);
  expect(result.output).toContain('src/features/routes/components/DamsonRow.tsx:5');
});

it('passes a push that is not a detail route', () => {
  expect(check(tree("navigateTo('/sync-settings')")).failed).toBe(false);
  expect(check(tree("navigateTo('/section-retired')")).failed).toBe(false);
});

it('passes a barrel member the cards never import by name', () => {
  const result = check(tree("openDetail({ kind: 'activity', id: 'a_plum' })"));

  expect(result.output).not.toContain('GreengageList');
  expect(result.failed).toBe(false);
});

it('follows a name through an export star to the module that defines it', () => {
  const result = check(
    tree("openDetail({ kind: 'activity', id: 'a_plum' })", {
      'src/features/routes/screens/PlumCard.tsx': [
        "import { MirabelleRow } from '../components';",
        'export function PlumCard() { return MirabelleRow(); }',
        '',
      ].join('\n'),
      'src/features/routes/components/orchard.ts': [
        "import { navigateTo } from '@/shared/app/navigation';",
        "export function MirabelleRow() { return () => navigateTo('/route/r_mirabelle'); }",
        '',
      ].join('\n'),
    })
  );

  expect(result.failed).toBe(true);
  expect(result.output).toContain('src/features/routes/components/orchard.ts:2');
});

it('reaches nothing through a type-only import', () => {
  const result = check(
    tree("openDetail({ kind: 'activity', id: 'a_plum' })", {
      'src/features/routes/screens/PlumCard.tsx': [
        "import type { GreengageList } from '../components';",
        "import { type DamsonRow } from '../components/DamsonRow';",
        'export function PlumCard(_list: typeof GreengageList, _row: typeof DamsonRow) {}',
        '',
      ].join('\n'),
      'src/features/routes/components/DamsonRow.tsx': damsonRow("navigateTo('/activity/a')"),
    })
  );

  expect(result.failed).toBe(false);
});

it('refuses a tree with no card registry rather than passing it', () => {
  const files: Record<string, string> = tree("openDetail({ kind: 'activity', id: 'a' })");
  delete files[REGISTRY];

  const result = check(files);

  expect(result.failed).toBe(true);
  expect(result.output).toContain('not found');
});
