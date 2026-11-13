/**
 * Scenario: a sheet route is added to `SCREEN_SHEETS`, or an existing one is rewritten, and draws
 * its own title row instead of the shared one.
 *
 * Expected behaviour: the guard names a sheet route that renders no `SheetHeader`, itself or
 * through the component it hands its body to, and a listed route with no file. A route that
 * renders it either way passes.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-sheet-headers.mjs');

function treeWith(sheets: string[], files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-sheet-headers-'));
  const table = sheets.map((route) => `  '${route}': 'fitToContents',`).join('\n');
  const all: Record<string, string> = {
    'src/shared/app/screenHeaders.ts': `export const SCREEN_SHEETS: Record<string, number[] | 'fitToContents'> = {\n${table}\n};\n`,
    ...files,
  };
  for (const [rel, body] of Object.entries(all)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

function runGuard(root: string) {
  try {
    const stdout = execFileSync('node', [GUARD, '--root', root], { encoding: 'utf8' });
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, output: `${e.stdout}${e.stderr}` };
  }
}

const OWN_HEADER = `export default function Kiln() {
  return <SheetHeader title="Glaze" onClose={() => {}} />;
}
`;
const OWN_TITLE = `export default function Kiln() {
  return <Text accessibilityRole="header">Glaze</Text>;
}
`;
const DELEGATES = `export default function Kiln() {
  return <GlazeSheet onClose={() => {}} />;
}
`;

describe('the sheet header guard', () => {
  it('passes a sheet route that renders SheetHeader itself', () => {
    const root = treeWith(['sheets/kiln'], { 'src/app/sheets/kiln.tsx': OWN_HEADER });
    expect(runGuard(root).status).toBe(0);
  });

  it('passes a sheet route whose body component renders SheetHeader', () => {
    const root = treeWith(['sheets/kiln'], {
      'src/app/sheets/kiln.tsx': DELEGATES,
      'src/features/pottery/components/GlazeSheet.tsx':
        'export function GlazeSheet() { return <SheetHeader title="Glaze" />; }\n',
    });
    expect(runGuard(root).status).toBe(0);
  });

  it('refuses a sheet route drawing its own title and names it', () => {
    const root = treeWith(['sheets/kiln', 'sheets/wheel'], {
      'src/app/sheets/kiln.tsx': OWN_TITLE,
      'src/app/sheets/wheel.tsx': OWN_HEADER,
    });
    const run = runGuard(root);
    expect(run.status).toBe(1);
    expect(run.output).toContain('src/app/sheets/kiln.tsx');
    expect(run.output).not.toContain('src/app/sheets/wheel.tsx');
  });

  it('refuses a route whose body component draws its own title', () => {
    const root = treeWith(['sheets/kiln'], {
      'src/app/sheets/kiln.tsx': DELEGATES,
      'src/features/pottery/components/GlazeSheet.tsx': `export function GlazeSheet() { return <Text>Glaze</Text>; }\n`,
    });
    const run = runGuard(root);
    expect(run.status).toBe(1);
    expect(run.output).toContain('src/app/sheets/kiln.tsx');
  });

  it('refuses a listed sheet route with no file', () => {
    const run = runGuard(treeWith(['sheets/kiln'], {}));
    expect(run.status).toBe(1);
    expect(run.output).toContain('sheets/kiln');
  });
});
