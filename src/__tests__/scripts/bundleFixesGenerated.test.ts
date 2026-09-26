/**
 * Scenario: `expo export:embed` regenerates the UniFFI bindings through the
 * bindgen's own hook, and the generator writes em dashes into its comments.
 *
 * Expected behaviour: the bundle step runs the fixer afterwards. Without it a
 * device build leaves two generated files dirty, `npm run audit` refuses them
 * across the whole tree, and every session's commit and merge fails on a file
 * nobody touched.
 *
 * What the fixer does is exercised on a copy. Pointed at the checkout, this
 * suite rewrote another session's uncommitted regeneration and then failed on
 * the diff it had itself created, which reads as flake rather than as a test
 * editing the tree.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.join(__dirname, '../../..');

/** The fixer the bundle step is expected to run, read back off the script. */
const FIXER = 'modules/veloqrs/scripts/fix-generated.sh';

it('runs the fixer after the export', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'scripts/bundle-android.mjs'), 'utf8');

  expect(source).toContain(FIXER);
  expect(source.indexOf("spawnSync('npx', args")).toBeLessThan(
    source.indexOf('spawnSync(command, []')
  );
});

/**
 * Scenario: an FFI change is followed by `scripts/generate-bindings.sh`, which
 * `CLAUDE.md` and the generated files' own header name as the way to
 * regenerate them.
 *
 * Expected behaviour: that path runs the fixer too. The bundle step already
 * does, but the bundle step is a device build; a session that only changes the
 * FFI surface never reaches it, so the em dashes the generator writes were
 * left in the tree and the commit was refused by a guard naming a file the
 * author did not write. The only remedy then is a hand edit the next
 * regeneration undoes.
 */
it('runs the fixer after generating the bindings by hand', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'scripts/generate-bindings.sh'), 'utf8');

  expect(source).toContain('scripts/fix-generated.sh');
  expect(source.indexOf('uniffi-bindgen-react-native generate')).toBeLessThan(
    source.indexOf('scripts/fix-generated.sh')
  );
});

it('names a fixer that exists and is executable', () => {
  const fixer = path.join(projectRoot, FIXER);

  expect(fs.existsSync(fixer)).toBe(true);
  expect(fs.statSync(fixer).mode & 0o111).not.toBe(0);
});

it('rewrites an em dash the generator wrote, on a copy and never on the checkout', () => {
  const generated = path.join(projectRoot, 'modules/veloqrs/src/generated/veloqrs.ts');
  const before = fs.readFileSync(generated, 'utf8');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-generated-'));
  fs.mkdirSync(path.join(root, 'src/generated'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, FIXER), path.join(root, 'scripts/fix-generated.sh'));
  fs.copyFileSync(
    path.join(projectRoot, 'modules/veloqrs/scripts/restore-ios-turbomodule.sh'),
    path.join(root, 'scripts/restore-ios-turbomodule.sh')
  );
  fs.writeFileSync(
    path.join(root, 'src/generated/veloqrs.ts'),
    '// Unconditional — a no-op where buffers are\n'
  );

  execFileSync(path.join(root, 'scripts/fix-generated.sh'), [], { cwd: root });

  const fixed = fs.readFileSync(path.join(root, 'src/generated/veloqrs.ts'), 'utf8');
  expect(fixed).toBe('// Unconditional, a no-op where buffers are\n');

  // Idempotent, which is the property the bundle step relies on: it runs after
  // every export and must not churn a file that is already right.
  execFileSync(path.join(root, 'scripts/fix-generated.sh'), [], { cwd: root });
  expect(fs.readFileSync(path.join(root, 'src/generated/veloqrs.ts'), 'utf8')).toBe(fixed);

  // The checkout every worktree shares is not the fixer's fixture. Running the
  // real script against the real file rewrote another session's in-flight
  // regeneration and then failed on the diff.
  expect(fs.readFileSync(generated, 'utf8')).toBe(before);

  fs.rmSync(root, { recursive: true, force: true });
});

/**
 * The spawn, not only the path named in the source. The fixer was reached by a
 * relative path with `cwd` set to the module directory, so it resolved under
 * that directory, `spawnSync` answered ENOENT, and `process.exit(fix.status ??
 * 1)` made the whole bundle step exit 1. The `&&` in `android:debug` then never
 * ran Gradle: a build wrote its bundle, stopped, and said nothing about a
 * fixer, because a spawn that never starts prints nothing through
 * `stdio: 'inherit'`.
 */
it('reaches the fixer from where the bundle step spawns it', () => {
  const printed = execFileSync(
    'node',
    [path.join(projectRoot, 'scripts/bundle-android.mjs'), '--print-fixer'],
    { cwd: projectRoot, encoding: 'utf8' }
  ).trim();

  const [command, cwd] = printed.split('\n');

  expect(fs.existsSync(cwd)).toBe(true);
  expect(fs.existsSync(command)).toBe(true);
  expect(fs.statSync(command).mode & 0o111).not.toBe(0);
});

/**
 * Scenario: a spawn that never starts answers a null status with the reason in
 * `error`, and `stdio: 'inherit'` prints nothing, because there was no child
 * to inherit anything. `process.exit(status ?? 1)` then ends the run with a
 * bare 1 and no account of itself.
 *
 * Expected behaviour: every spawn in a script an operator waits on reports
 * why it could not start. The bundle step sits behind a thirteen-minute wait
 * for the Android lock, and the harness behind a device one, so a silent exit
 * there costs the wait as well as the run.
 */
describe('a spawn that cannot start says so', () => {
  const scripts = ['scripts/bundle-android.mjs', 'scripts/cold-start-scaling-harness.mjs'];

  it.each(scripts)('%s checks error on every spawn it exits on', (script) => {
    const source = fs.readFileSync(path.join(projectRoot, script), 'utf8');
    const spawns = source.match(/spawnSync\(/g) ?? [];
    const reported = source.match(/\.error\) \{/g) ?? [];

    expect(spawns.length).toBeGreaterThan(0);
    expect(reported.length).toBe(spawns.length);
  });

  it.each(scripts)('%s names the command it could not run', (script) => {
    const source = fs.readFileSync(path.join(projectRoot, script), 'utf8');

    expect(source).toMatch(/could not run \$\{?/);
    expect(source).toContain('.error.message');
  });

  it('never falls back to 1 for a status it has already proven is a number', () => {
    const source = fs.readFileSync(path.join(projectRoot, 'scripts/bundle-android.mjs'), 'utf8');

    // `status ?? 1` after an `error` branch reads as if a null status were
    // still possible, which is the shape that hid the fault.
    expect(source).toContain('process.exit(run.status)');
  });
});
