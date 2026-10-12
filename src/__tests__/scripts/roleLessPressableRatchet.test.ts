/**
 * Scenario: press targets outside the shared ui carry no `accessibilityRole`, so a screen reader
 * announces them as plain elements. Nothing counted them, so the number could only grow.
 *
 * Expected behaviour: a per-file ceiling that counts opening `TouchableOpacity`, `Pressable` and
 * `AnimatedPressable` tags with no role and no props spread. A file above its baseline or unlisted
 * fails and names itself, a file the tree has beaten fails with the flag to paste back.
 *
 * A press target with a role and no name is refused outright, with no baseline: one with neither
 * an `accessibilityLabel` nor a text child is announced as "button" and nothing else.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-roleless-pressables.mjs');

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-roles-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

function runGuard(root: string, baseline: Record<string, number>) {
  const baselineFile = path.join(root, 'baseline.json');
  fs.writeFileSync(baselineFile, JSON.stringify(baseline));
  try {
    const stdout = execFileSync('node', [GUARD, '--root', root, '--baseline', baselineFile], {
      encoding: 'utf8',
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, output: `${e.stdout}${e.stderr}` };
  }
}

const FILE = 'src/features/a/A.tsx';

const ROLELESS = `
export const A = () => (
  <Pressable
    onPress={() => go(a > b)}
    style={{ flex: 1 }}
  >
    <Text />
  </Pressable>
);
`;

describe('the role-less pressable ratchet', () => {
  it('refuses a role-less pressable in a file the baseline never listed', () => {
    const root = treeWith({ [FILE]: ROLELESS });
    const run = runGuard(root, {});

    expect(run.status).toBe(1);
    expect(run.output).toContain(FILE);
  });

  it('passes a file sitting exactly on its baseline', () => {
    const root = treeWith({ [FILE]: ROLELESS });

    expect(runGuard(root, { [FILE]: 1 }).status).toBe(0);
  });

  it('counts a multi-line tag whose props hold arrows and braces', () => {
    const root = treeWith({
      [FILE]: `${ROLELESS}<TouchableOpacity onPress={() => x({ a: 1 })} />`,
    });

    expect(runGuard(root, { [FILE]: 1 }).status).toBe(1);
    expect(runGuard(root, { [FILE]: 2 }).status).toBe(0);
  });

  it('counts an animated pressable', () => {
    const root = treeWith({ [FILE]: '<AnimatedPressable onPress={f} />' });

    expect(runGuard(root, {}).status).toBe(1);
  });

  it('counts an icon that takes a press itself', () => {
    const root = treeWith({
      [FILE]: `
        <MaterialCommunityIcons name="close" size={24} onPress={f} />
        <MaterialIcons
          name="close"
          onPress={() => g({ a: 1 })}
        >
        </MaterialIcons>
      `,
    });

    expect(runGuard(root, { [FILE]: 1 }).status).toBe(1);
    expect(runGuard(root, { [FILE]: 2 }).status).toBe(0);
  });

  it('does not count an icon with no press, or one with a role and a label', () => {
    const root = treeWith({
      [FILE]: `
        <MaterialCommunityIcons name="close" size={24} />
        <MaterialCommunityIcons accessibilityRole="button" accessibilityLabel={label} onPress={f} />
      `,
    });

    expect(runGuard(root, {}).status).toBe(0);
  });

  it('does not count a tag with a role, or one that spreads props', () => {
    const root = treeWith({
      [FILE]: `
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={f} />
        <TouchableOpacity {...props} />
      `,
    });

    expect(runGuard(root, {}).status).toBe(0);
  });

  it('does not count another component whose name starts the same', () => {
    const root = treeWith({ [FILE]: '<PressableRow onPress={f} />' });

    expect(runGuard(root, {}).status).toBe(0);
  });

  it('refuses a baseline left above the tree, so ground taken is kept', () => {
    const root = treeWith({ [FILE]: ROLELESS });
    const run = runGuard(root, { [FILE]: 4 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('--write');
  });

  it('counts neither the shared ui nor the tests', () => {
    const root = treeWith({
      'src/shared/ui/Button.tsx': ROLELESS,
      'src/__tests__/a.test.tsx': ROLELESS,
    });

    expect(runGuard(root, {}).status).toBe(0);
  });

  describe('a named role', () => {
    const ICON_ONLY = `
export const A = () => (
  <Pressable accessibilityRole="button" onPress={f}>
    <MaterialCommunityIcons name="layers" size={20} />
  </Pressable>
);
`;

    it.each([
      ['src/features/a/A.tsx', { 'src/features/a/A.tsx': 5 }],
      ['src/shared/ui/A.tsx', {}],
    ])(
      'refuses an icon-only pressable with a role and no label in %s, whatever the baseline',
      (file, baseline) => {
        const root = treeWith({ [file]: ICON_ONLY });
        const run = runGuard(root, baseline);

        expect(run.status).toBe(1);
        expect(run.output).toContain(`${file}:3`);
      }
    );

    it('refuses a self-closing pressable with a role and no label', () => {
      const root = treeWith({
        [FILE]: '<TouchableOpacity accessibilityRole="button" onPress={f} />',
      });

      expect(runGuard(root, {}).status).toBe(1);
    });

    it('refuses an icon that takes a press with a role and no label', () => {
      const root = treeWith({
        [FILE]: '<MaterialCommunityIcons name="x" accessibilityRole="button" onPress={f} />',
      });
      const run = runGuard(root, {});

      expect(run.status).toBe(1);
      expect(run.output).toContain(`${FILE}:1`);
    });

    it('passes a pressable named by its label, by a text child or by a spread', () => {
      const root = treeWith({
        [FILE]: `
          <Pressable accessibilityRole="button" accessibilityLabel={t('a.b')} onPress={f}>
            <Icon />
          </Pressable>
          <Pressable accessibilityRole="button" onPress={f}>
            <Icon />
            <Animated.Text>{label}</Animated.Text>
          </Pressable>
          <Pressable accessibilityRole="button" {...props}>
            <Icon />
          </Pressable>
        `,
      });

      expect(runGuard(root, {}).status).toBe(0);
    });

    it('reads a nested pressable as its own control', () => {
      const root = treeWith({
        [FILE]: `
          <Pressable accessibilityRole="button" onPress={f}>
            <Pressable accessibilityRole="button" onPress={g}>
              <Icon />
            </Pressable>
            <Text>outer</Text>
          </Pressable>
        `,
      });

      expect(runGuard(root, {}).status).toBe(1);
    });

    it('does not check a test file', () => {
      const root = treeWith({ 'src/__tests__/a.test.tsx': ICON_ONLY });

      expect(runGuard(root, {}).status).toBe(0);
    });
  });
});
