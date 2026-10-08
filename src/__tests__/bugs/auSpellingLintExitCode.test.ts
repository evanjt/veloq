/**
 * Scenario: the veloqrs crate carried both spellings at once, so
 * `normalize_features` sat beside `ensure_visit_count_denormalisation` and a
 * grep for either form missed the other.
 *
 * Expected behaviour: the guard fails on the American form, and passes the
 * words that are not ours to spell: serde, HTTP, the UniFFI surface and the
 * one phase token TypeScript keys on.
 *
 * The guard also reads the two English locale files, which is how `Reanalyze
 * sections` shipped to en-AU. Their allowlist is not the crate's: a phase
 * token has no business in a string an athlete reads.
 *
 * TypeScript under `src`, `modules/veloqrs/src` and `scripts` is read as well,
 * with the vendor and UniFFI names that are not ours to spell left alone.
 */

import { execFileSync } from 'node:child_process';
import { initFixtureRepo, runGit, gitFreeEnv } from '../__shared__/gitFixture';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-au-spelling.mjs');
const CRATE = 'modules/veloqrs/rust/veloqrs/src';
const LOCALES = 'src/i18n/locales';
const TRACEMATCH = 'modules/veloqrs/rust/tracematch';

function runGuard(root?: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', root ? [SCRIPT, '--root', root] : [SCRIPT], {
      env: gitFreeEnv(),
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

function crate(contents: string): string {
  const root = mkdtempSync(join(tmpdir(), 'au-spelling-'));
  roots.push(root);
  const full = join(root, CRATE, 'lib.rs');
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents);
  initFixtureRepo(root);
  return root;
}

/** A checkout holding one tracked TypeScript file at `path`. */
function tsFile(path: string, contents: string): string {
  const root = mkdtempSync(join(tmpdir(), 'au-spelling-ts-'));
  roots.push(root);
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), contents);
  initFixtureRepo(root);
  return root;
}

function locales(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'au-spelling-locale-'));
  roots.push(root);
  mkdirSync(join(root, LOCALES), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, LOCALES, name), JSON.stringify(body, null, 2));
  }
  initFixtureRepo(root);
  return root;
}

/** A checkout whose tracematch submodule holds `files`, each path under its `src`. */
function withSubmodule(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'au-spelling-sub-'));
  roots.push(root);
  const sub = join(root, TRACEMATCH);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(sub, 'src', name, '..'), { recursive: true });
    writeFileSync(join(sub, 'src', name), body);
  }
  initFixtureRepo(sub);
  runGit(['commit', '-q', '--no-gpg-sign', '-m', 'fixture'], sub);
  writeFileSync(join(root, 'README.txt'), 'fixture\n');
  initFixtureRepo(root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('fails on an American identifier', () => {
  const { status, output } = runGuard(crate('fn normalize_features() {}\n'));

  expect(status).toBe(1);
  expect(output).toContain(`${CRATE}/lib.rs:1`);
  expect(output).toContain('normalis');
});

it('fails on an American word in a comment', () => {
  expect(runGuard(crate('// materialized PR and trend badges\n')).status).toBe(1);
});

it('passes serde, which names its own traits', () => {
  expect(runGuard(crate('#[derive(Serialize, Deserialize)]\nstruct A;\n')).status).toBe(0);
});

it('passes the HTTP spellings, which the RFC fixes', () => {
  expect(
    runGuard(crate('const H: &str = "Authorization";\nconst S: u16 = 401; // Unauthorized\n'))
      .status
  ).toBe(0);
});

it('passes the UniFFI surface, a rename there is not a spelling change', () => {
  expect(runGuard(crate('fn is_initialized(&self) -> bool { true }\n')).status).toBe(0);
});

it('still fails on our own initialisation prose beside the exempt name', () => {
  const { status, output } = runGuard(
    crate('/// Initialize the schema.\nfn is_initialized() -> bool { true }\n')
  );

  expect(status).toBe(1);
  expect(output).toContain(`${CRATE}/lib.rs:1`);
  expect(output).not.toContain(`${CRATE}/lib.rs:2`);
});

it("passes a vendor's own error variant quoted in a comment", () => {
  expect(runGuard(crate('// ok() ignores AlreadyInitialized on repeated calls\n')).status).toBe(0);
});

it('passes the phase token TypeScript keys on', () => {
  expect(runGuard(crate('set_phase("analyzing", n);\n')).status).toBe(0);
});

it('ignores files outside the crate', () => {
  const root = crate('// clean\n');
  writeFileSync(join(root, 'notes.md'), 'normalized\n');
  runGit(['add', '-A'], root);

  expect(runGuard(root).status).toBe(0);
});

describe('the English locale files are read too', () => {
  it('fails on an American spelling in a string the athlete reads', () => {
    const { status, output } = runGuard(
      locales({ 'en-AU.json': { settings: { reanalyzeSections: 'Reanalyze sections' } } })
    );

    expect(status).toBe(1);
    expect(output).toContain('en-AU.json');
    expect(output).toContain('settings.reanalyzeSections');
    expect(output).toContain('analys');
  });

  it('passes the Australian spelling of the same string', () => {
    expect(
      runGuard(
        locales({
          'en-AU.json': {
            settings: { reanalyzeSections: 'Reanalyse sections', note: 'Re-analysed just now' },
          },
        })
      ).status
    ).toBe(0);
  });

  it('reads en-GB as well', () => {
    const { status, output } = runGuard(
      locales({ 'en-GB.json': { settings: { colorScheme: 'Color scheme' } } })
    );

    expect(status).toBe(1);
    expect(output).toContain('en-GB.json');
  });

  it("does not carry the crate's allowlist into a locale file", () => {
    expect(runGuard(locales({ 'en-AU.json': { routes: { phase: 'analyzing' } } })).status).toBe(1);
  });

  it('leaves the sixteen other locales alone, they are not ours to spell', () => {
    expect(
      runGuard(locales({ 'fr.json': { settings: { color: 'Couleur behavior' } } })).status
    ).toBe(0);
  });

  it('reads a value nested several levels down', () => {
    const { status, output } = runGuard(
      locales({ 'en-AU.json': { a: { b: { c: { d: 'Optimize the route' } } } } })
    );

    expect(status).toBe(1);
    expect(output).toContain('a.b.c.d');
  });
});

describe('the tracematch submodule is read from its own index', () => {
  it('fails on an American word in submodule prose', () => {
    const { status, output } = runGuard(
      withSubmodule({ 'grouping.rs': '// fine\n// Initialize the groups\n' })
    );

    expect(status).toBe(1);
    expect(output).toContain(`${TRACEMATCH}/src/grouping.rs:2`);
    expect(output).toContain('initialis');
    expect(output).not.toContain('grouping.rs:1');
  });

  it('fails on an American identifier in a nested directory', () => {
    const { status, output } = runGuard(
      withSubmodule({ 'sections/consensus.rs': 'fn normalize_track() {}\n' })
    );

    expect(status).toBe(1);
    expect(output).toContain(`${TRACEMATCH}/src/sections/consensus.rs:1`);
  });

  it('passes Australian prose', () => {
    expect(
      runGuard(withSubmodule({ 'lib.rs': '// Normalise, then initialise the behaviour\n' })).status
    ).toBe(0);
  });

  it('reads only Rust under src, not the submodule docs or tests', () => {
    expect(
      runGuard(withSubmodule({ 'lib.rs': '// ok\n', '../README.md': 'behavior\n' })).status
    ).toBe(0);
  });

  it('passes the parsed scale name and its module path', () => {
    expect(
      runGuard(
        withSubmodule({
          'sections/mod.rs': [
            'pub mod optimized;',
            'pub use optimized::recalculate_section_polyline;',
            'pub enum ScaleName {',
            '    Optimized,',
            '}',
            'fn as_str() { ScaleName::Optimized => "optimized" }',
            'fn from_str() { "optimized" => Ok(ScaleName::Optimized) }',
            'fn go() { optimized::recalculate_section_polyline() }',
            '',
          ].join('\n'),
        })
      ).status
    ).toBe(0);
  });

  it('still fails on optimized in prose beside the exempt scale name', () => {
    const { status, output } = runGuard(
      withSubmodule({
        'lib.rs': '/// optimized for comparison\nconst S: &str = "optimized";\n',
      })
    );

    expect(status).toBe(1);
    expect(output).toContain('lib.rs:1');
    expect(output).not.toContain('lib.rs:2');
  });

  it('refuses a submodule the index names but the disk does not hold', () => {
    const root = withSubmodule({ 'lib.rs': '// clean\n' });
    rmSync(join(root, TRACEMATCH, '.git'), { recursive: true, force: true });

    const { status, output } = runGuard(root);

    expect(status).toBe(1);
    expect(output).toContain('tracematch');
  });
});

describe('TypeScript is read too', () => {
  it.each([
    ['src/shared/app/Store.ts', 'export function initializeFooStore() {}\n', 'initialis'],
    ['src/features/x/Panel.tsx', 'const normalizeBounds = () => 0;\n', 'normalis'],
    ['modules/veloqrs/src/delegates/x.ts', '// optimized for reads\n', 'optimis'],
    ['scripts/lib/x.ts', 'export const analyzer = 1;\n', 'analys'],
  ])('fails on an American spelling in %s', (path, contents, good) => {
    const { status, output } = runGuard(tsFile(path, contents));

    expect(status).toBe(1);
    expect(output).toContain(`${path}:1`);
    expect(output).toContain(good);
  });

  it('names the line of the offence and not the clean ones around it', () => {
    const { output } = runGuard(
      tsFile('src/a.ts', '// clean\nexport const normalizeTrackPoints = 1;\n// clean\n')
    );

    expect(output).toContain('src/a.ts:2');
    expect(output).not.toContain('src/a.ts:1');
    expect(output).not.toContain('src/a.ts:3');
  });

  it('fails on behavior in prose', () => {
    expect(runGuard(tsFile('src/a.ts', '// the existing behavior\n')).status).toBe(1);
  });

  it('passes the Australian spelling of the same names', () => {
    expect(
      runGuard(
        tsFile(
          'src/a.ts',
          'export function initialiseFooStore() {}\nconst normaliseBounds = 1; // behaviour\n'
        )
      ).status
    ).toBe(0);
  });

  it('does not read generated files', () => {
    const root = tsFile('src/shared/native/unifiedConfig.generated.ts', 'const normalize = 1;\n');
    mkdirSync(join(root, 'modules/veloqrs/src/generated'), { recursive: true });
    writeFileSync(join(root, 'modules/veloqrs/src/generated/veloqrs.ts'), 'initialize();\n');
    runGit(['add', '-A'], root);

    expect(runGuard(root).status).toBe(0);
  });

  it('does not read TypeScript outside the three roots', () => {
    expect(runGuard(tsFile('widget/x.ts', 'const normalize = 1;\n')).status).toBe(0);
  });

  it('does not ban color, which style keys and component props spell', () => {
    expect(
      runGuard(tsFile('src/a.tsx', 'const s = { color: theme.color, backgroundColor: c };\n'))
        .status
    ).toBe(0);
  });

  it.each([
    ['the UniFFI engine method', 'if (!engine.isInitialized()) return;'],
    ['the i18next flag', 'if (!i18n.isInitialized) return;'],
    ['the generated free function', 'generated.default.initialize();'],
    ['the generated free function in a mock', 'const m = { default: { initialize: jest.fn() } };'],
    ['the compiler API property', 'const init = node.initializer;'],
    ['the keyboard avoiding prop', "<KeyboardAvoidingView behavior={'padding'} />"],
    ['the notification handler type', 'type H = Notifications.NotificationBehavior;'],
    ['the engine error tag', "const tag = 'NotInitialized';"],
    ['the phase token', "const phase = 'analyzing';"],
    ['the phase token as a table key', "  analyzing: 'Analysing activities',"],
    ['the Android intent action', "'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS'"],
    ['the scale name the engine parses', "const scale = 'optimized';"],
    ['the locale key', "t('cache.analyzingRoutes');"],
  ])('passes %s', (_name, line) => {
    expect(runGuard(tsFile('src/a.tsx', `${line}\n`)).status).toBe(0);
  });

  it('still fails on our own initialisation beside the exempt name', () => {
    const { status, output } = runGuard(
      tsFile('src/a.ts', 'const initializeStore = 1;\nif (!i18n.isInitialized) return;\n')
    );

    expect(status).toBe(1);
    expect(output).toContain('src/a.ts:1');
    expect(output).not.toContain('src/a.ts:2');
  });

  it('fails on a name that begins like the compiler API property', () => {
    expect(
      runGuard(tsFile('src/a.ts', 'const r = useStore((s) => s.initializeRange);\n')).status
    ).toBe(1);
  });

  it('fails on a store flag spelled the American way', () => {
    expect(runGuard(tsFile('src/a.ts', 'set({ isInitialized: true });\n')).status).toBe(1);
  });
});
