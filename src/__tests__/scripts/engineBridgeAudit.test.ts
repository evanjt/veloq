/**
 * Scenario: a hook reads the engine through `useQuery` under a key whose root
 * tuple differs from its group's invalidated root. Invalidating
 * `['widgets']` does not reach `['widget-detail', id]`, so the data stays
 * stale after a sync while the group still counts as covered.
 *
 * Expected behaviour: the audit fails a file keyed on a member whose root
 * nothing invalidates, and passes one keyed on a member whose root is.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/engine-event-bridge-audit.mjs');
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const QUERY_KEYS = `export const queryKeys = {
  widgets: {
    all: ['widgets'] as const,
    detail: (id: string) => ['widget-detail', id] as const,
    list: (id: string) => ['widgets', id] as const,
  },
};
`;

const GLOBAL_SYNC = `import { queryKeys } from '@/shared/query/queryKeys';
queryClient.invalidateQueries({ queryKey: queryKeys.widgets.all });
`;

const BACKUP = `const storeInitialisers = () => [
];
`;

function hook(member: string): string {
  return `import { useQuery } from '@tanstack/react-query';
export function useWidget(id: string) {
  return useQuery({
    queryKey: queryKeys.widgets.${member}(id),
    queryFn: () => getEngine().widget(id),
  });
}
`;
}

function runAudit(hookSource: string): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'bridge-audit-'));
  roots.push(root);
  const files: Record<string, string> = {
    'src/shared/query/queryKeys.ts': QUERY_KEYS,
    'src/shared/app/GlobalDataSync.tsx': GLOBAL_SYNC,
    'src/features/settings/lib/backup.ts': BACKUP,
    'src/features/widgets/useWidget.ts': hookSource,
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

it('fails a file keyed on a member whose root nothing invalidates', () => {
  const { status, output } = runAudit(hook('detail'));

  expect(status).toBe(1);
  expect(output).toContain('src/features/widgets/useWidget.ts');
  expect(output).toContain('widgets.detail');
});

it('passes a file keyed on a member under an invalidated root', () => {
  expect(runAudit(hook('list')).status).toBe(0);
});
