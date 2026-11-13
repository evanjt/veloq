/**
 * Scenario: a sheet route, a map sheet route or the component its body names scrolls with a bare
 * `ScrollView`, `FlatList` or `SectionList`.
 *
 * Expected behaviour: the guard names the file, since Android's sheet then takes every downward
 * drag and the body never scrolls back to its top. A body that scrolls through `SheetScrollView`,
 * spreads `sheetScrollProps`, or scrolls sideways passes.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/check-sheet-scroll.mjs');

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-sheet-scroll-'));
  for (const [rel, body] of Object.entries(files)) {
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

const BARE = `export default function Kiln() {
  return (
    <View>
      <SheetHeader title="Glaze" />
      <ScrollView contentContainerStyle={styles.list}>{rows}</ScrollView>
    </View>
  );
}
`;
const SHARED = `export default function Kiln() {
  return <SheetScrollView contentContainerStyle={styles.list}>{rows}</SheetScrollView>;
}
`;
const SPREAD = `export default function Kiln() {
  return (
    <FlatList
      data={glazes}
      renderItem={({ item }) => <Row title={item} />}
      {...sheetScrollProps}
    />
  );
}
`;
const SIDEWAYS = `export default function Kiln() {
  return (
    <SheetScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>{chips}</ScrollView>
    </SheetScrollView>
  );
}
`;
const DELEGATES = `export default function KilnSheet() {
  return (
    <MapSheetHostSheet>
      <GlazeCard id={id} />
    </MapSheetHostSheet>
  );
}
`;

describe('the sheet scroll guard', () => {
  it('passes a sheet route that scrolls through SheetScrollView', () => {
    expect(runGuard(treeWith({ 'src/app/sheets/kiln.tsx': SHARED })).status).toBe(0);
  });

  it('passes a list that spreads sheetScrollProps', () => {
    expect(runGuard(treeWith({ 'src/app/sheets/kiln.tsx': SPREAD })).status).toBe(0);
  });

  it('passes a scroll view that scrolls sideways', () => {
    expect(runGuard(treeWith({ 'src/app/sheets/kiln.tsx': SIDEWAYS })).status).toBe(0);
  });

  it('refuses a sheet route with a bare scroll view and names it', () => {
    const run = runGuard(
      treeWith({ 'src/app/sheets/kiln.tsx': BARE, 'src/app/sheets/wheel.tsx': SHARED })
    );
    expect(run.status).toBe(1);
    expect(run.output).toContain('src/app/sheets/kiln.tsx');
    expect(run.output).not.toContain('src/app/sheets/wheel.tsx');
  });

  it('refuses a bare list in a component a map sheet route names', () => {
    const run = runGuard(
      treeWith({
        'src/app/kiln/[id]/sheet.tsx': DELEGATES,
        'src/features/pottery/GlazeCard.tsx': BARE,
      })
    );
    expect(run.status).toBe(1);
    expect(run.output).toContain('src/features/pottery/GlazeCard.tsx');
  });

  it('passes a component a sheet names when it spreads sheetScrollProps', () => {
    const run = runGuard(
      treeWith({
        'src/app/kiln/[id]/sheet.tsx': DELEGATES,
        'src/features/pottery/GlazeCard.tsx': SPREAD,
      })
    );
    expect(run.status).toBe(0);
  });

  it('leaves a scroll view outside any sheet alone', () => {
    expect(runGuard(treeWith({ 'src/app/kiln/index.tsx': BARE })).status).toBe(0);
  });
});
