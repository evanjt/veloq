/**
 * Scenario: a tap was answered three ways on one screen. 23 files dimmed to
 * React Native's default 0.2, 75 uses to 0.7, and 45 of the 52 files rendering
 * a `Pressable` showed nothing at all.
 *
 * Expected behaviour: the guard fails a `Pressable` with neither a pressed
 * style nor a ripple, accepts the shared helper, accepts a press that says in
 * a comment why it is not a control, and passes on this repository.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-press-feedback.mjs');

function runGuard(root?: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', root ? [SCRIPT, '--root', root] : [SCRIPT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'press-feedback-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('fails a press that shows nothing', () => {
  const root = fixture({
    'src/features/x/Row.tsx': [
      'export function Row() {',
      '  return <Pressable style={styles.row} onPress={go} />;',
      '}',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/x/Row.tsx:2');
});

it('fails one with no style at all', () => {
  const root = fixture({
    'src/features/x/Icon.tsx':
      'export const Icon = () => <Pressable onPress={go}>{child}</Pressable>;\n',
  });

  expect(runGuard(root).status).toBe(1);
});

it('accepts the shared helper and a ripple', () => {
  const root = fixture({
    'src/features/x/Helper.tsx':
      '<Pressable style={pressable(styles.row)} android_ripple={pressRipple} onPress={go} />\n',
    'src/features/x/Ripple.tsx':
      '<Pressable style={styles.row} android_ripple={{ borderless: false }} onPress={go} />\n',
  });

  expect(runGuard(root).status).toBe(0);
});

it('fails a hand-written pressed style, which gives its own look', () => {
  const root = fixture({
    'src/features/x/Written.tsx':
      '<Pressable style={({ pressed }) => [styles.row, pressed && dim]} onPress={go} />\n',
    'src/features/x/Called.tsx': '<Pressable style={rowStyle(theme)} onPress={go} />\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/x/Written.tsx:1');
  expect(output).toContain('src/features/x/Called.tsx:1');
});

it('fails the helper with no ripple beside it, which shows nothing on Android', () => {
  const root = fixture({
    'src/features/x/Chip.tsx': [
      'export const Chip = () => (',
      '  <Pressable style={pressable(styles.chip)} onPress={go} />',
      ');',
    ].join('\n'),
    'src/features/x/Wrapped.tsx':
      '<Pressable style={(state) => [pressable()(state), styles.name]} onPress={go} />\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/x/Chip.tsx:2');
  expect(output).toContain('src/features/x/Wrapped.tsx:1');
});

it('accepts a press that says why it is not a control', () => {
  const root = fixture({
    'src/features/x/Sheet.tsx': [
      '{/* press-feedback: none, the scrim is the way out and not a control */}',
      '<Pressable style={styles.overlay} onPress={onDismiss} />',
    ].join('\n'),
  });

  expect(runGuard(root).status).toBe(0);
});

it('does not take that reason from further up the file', () => {
  const root = fixture({
    'src/features/x/Far.tsx': [
      '// press-feedback: none, the scrim above',
      '<Pressable style={styles.overlay} onPress={onDismiss} />',
      '',
      '<Pressable style={styles.row} onPress={go} />',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/x/Far.tsx:4');
});

it('ignores tests, which render a bare Pressable on purpose', () => {
  const root = fixture({
    'src/__tests__/row.test.tsx': '<Pressable onPress={go} />\n',
  });

  expect(runGuard(root).status).toBe(0);
});

it('refuses a TouchableOpacity without activeOpacity beside one that sets it', () => {
  const root = fixture({
    'src/features/x/Rows.tsx': [
      '<TouchableOpacity activeOpacity={0.7} onPress={open} />',
      '<TouchableOpacity onPress={close} />',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/x/Rows.tsx:2');
});

it('accepts an explicit opacity or a props spread on each TouchableOpacity', () => {
  const root = fixture({
    'src/features/x/Rows.tsx': [
      '<TouchableOpacity activeOpacity={0.7} onPress={open} />',
      '<TouchableOpacity {...props} onPress={close} />',
    ].join('\n'),
  });

  expect(runGuard(root).status).toBe(0);
});
