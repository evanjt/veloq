/**
 * Scenario: the connect page is TypeScript under web/connect/, built into
 * content-hashed files that the deploy uploads. A browser that holds a cached
 * module from one deploy must never be handed a module from another.
 *
 * Expected behaviour: every script and style in the output carries a hash of
 * its content in its name, the page names exactly those files, a rebuild of
 * the same source gives the same names, an edit moves the script's name and
 * leaves the stylesheet's, nothing from an earlier build survives, and the
 * content security policy reaches the output byte for byte. The map renderer is
 * the app's vendored copy: its script, stylesheet and licence ship under hashed
 * names with the app's bytes, the page loads the script before its module, and a
 * copy that is not the bytes the app pins is refused.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const ROOT = resolve(__dirname, '../../..');
const BUILD = join(ROOT, 'scripts/build-connect-page.mjs');
const GUARD = join(ROOT, 'scripts/check-connect-page-local.mjs');
const RENDERER = 'modules/veloqrs/assets/basemap/renderer';

/** The app's locale bundles and type module, which the build reads beside the page. */
const I18N = resolve(__dirname, '../../i18n');
/** The app's source, which the page imports through its alias. */
const APP_SOURCE = resolve(__dirname, '../..');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A scratch repository root holding a copy of the page's source. */
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'connect-build-'));
  roots.push(root);
  mkdirSync(join(root, 'web'), { recursive: true });
  cpSync(join(ROOT, 'web/connect'), join(root, 'web/connect'), { recursive: true });
  // The page reads the engine's track encoding with the app's own decoder.
  mkdirSync(join(root, 'modules/veloqrs/src'), { recursive: true });
  cpSync(join(ROOT, 'modules/veloqrs/src/coords.ts'), join(root, 'modules/veloqrs/src/coords.ts'));
  // The renderer the app ships is copied, so a test can alter it. The source the
  // page imports is linked, all but the locale bundles, which a test edits.
  mkdirSync(join(root, RENDERER), { recursive: true });
  cpSync(join(ROOT, RENDERER), join(root, RENDERER), { recursive: true });
  mkdirSync(join(root, 'src'));
  for (const entry of readdirSync(APP_SOURCE)) {
    if (entry !== 'i18n') symlinkSync(join(APP_SOURCE, entry), join(root, 'src', entry));
  }
  cpSync(I18N, join(root, 'src/i18n'), { recursive: true });
  // The page imports React, which the bundler resolves from the root it builds.
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'));
  return root;
}

function run(script: string, args: string[]): { status: number; output: string } {
  const result = spawnSync('node', [script, ...args], { env: gitFreeEnv(), encoding: 'utf8' });
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

const build = (root: string) => run(BUILD, ['--root', root]);
const outputOf = (root: string) => join(root, 'docs/connect');
const files = (root: string) => readdirSync(outputOf(root)).sort();
const page = (root: string) => readFileSync(join(outputOf(root), 'index.html'), 'utf8');

/** The script and style names the page refers to. */
function references(html: string): { script: string; style: string } {
  const script = html.match(/<script type="module" src="([^"]+)"/)?.[1];
  const style = html.match(/<link rel="stylesheet" href="([^"]+)"/)?.[1];
  if (!script || !style) throw new Error('the built page names no script or no style');
  return { script, style };
}

describe('connect page build', () => {
  it('names every script and style by a hash of its content, and the page names those files', () => {
    const root = scratch();
    expect(build(root)).toMatchObject({ status: 0 });

    const built = files(root);
    const hashed = built.filter((name) => /\.(js|css)$/.test(name));
    expect(hashed.length).toBeGreaterThanOrEqual(2);
    for (const name of hashed) expect(name).toMatch(/^[a-z]+-[A-Z0-9]{8}\.(js|css)$/);

    const { script, style } = references(page(root));
    expect(built).toContain(script);
    expect(built).toContain(style);
    expect(script).toMatch(/^boot-[A-Z0-9]{8}\.js$/);
    expect(existsSync(join(outputOf(root), 'qr.LICENSE.txt'))).toBe(true);
  });

  it("ships the app's renderer, stylesheet and licence under hashed names and loads the renderer first", () => {
    const root = scratch();
    expect(build(root)).toMatchObject({ status: 0 });
    const html = page(root);
    const script = html.match(/<script src="(maplibre-[A-Z0-9]{8}\.js)"><\/script>/)?.[1];
    const style = html.match(/<link rel="stylesheet" href="(maplibre-[A-Z0-9]{8}\.css)"/)?.[1];
    expect(script).toBeDefined();
    expect(style).toBeDefined();
    expect(html.indexOf(script as string)).toBeLessThan(html.indexOf('<script type="module"'));

    const app = (name: string) => readFileSync(join(ROOT, RENDERER, name));
    expect(readFileSync(join(outputOf(root), script as string))).toEqual(
      app('maplibre-gl-5.19.0.js')
    );
    expect(readFileSync(join(outputOf(root), style as string))).toEqual(
      app('maplibre-gl-5.19.0.css')
    );
    const licence = files(root).find((name) => /^maplibre\.LICENSE-[A-Z0-9]{8}\.txt$/.test(name));
    expect(licence).toBeDefined();
    expect(readFileSync(join(outputOf(root), licence as string))).toEqual(app('LICENSE.txt'));
  });

  it("bundles the app's map styles without the native modules its theme index reaches", () => {
    const root = scratch();
    expect(build(root)).toMatchObject({ status: 0 });
    const own = files(root).filter((name) => /^(main|boot|chunk)-.*\.js$/.test(name));
    const bundled = own.map((name) => readFileSync(join(outputOf(root), name), 'utf8')).join('\n');
    expect(bundled).toContain('https://tiles.openfreemap.org/planet');
    expect(bundled).not.toContain('react-native');
  });

  it("bundles the app's insight generators and formatting without the native modules they reach for", () => {
    const root = scratch();
    expect(build(root)).toMatchObject({ status: 0 });
    const own = files(root).filter((name) => /^(main|boot|chunk)-.*\.js$/.test(name));
    const bundled = own.map((name) => readFileSync(join(outputOf(root), name), 'utf8')).join('\n');
    // A key only the generators and the formatting module carry.
    expect(bundled).toContain('insights.efficiencyTrend.quantity');
    expect(bundled).toContain('units.hoursMinutes');
    expect(bundled).not.toContain('react-native');
    expect(bundled).not.toContain('expo-localization');
  });

  it('refuses a renderer that is not the bytes the app pins', () => {
    const root = scratch();
    const renderer = join(root, RENDERER, 'maplibre-gl-5.19.0.js');
    writeFileSync(renderer, `${readFileSync(renderer, 'utf8')}\n`);
    const result = build(root);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('is not the bytes');
  });

  it('refuses a renderer with no licence beside it', () => {
    const root = scratch();
    rmSync(join(root, RENDERER, 'LICENSE.txt'));
    const result = build(root);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('LICENSE.txt is missing');
  });

  it("leaves the renderer's names alone on an edit to the page", () => {
    const root = scratch();
    build(root);
    const named = () => files(root).filter((name) => name.startsWith('maplibre'));
    const before = named();
    const link = join(root, 'web/connect/link.ts');
    writeFileSync(link, readFileSync(link, 'utf8').replace('= 110;', '= 111;'));
    build(root);
    expect(named()).toEqual(before);
  });

  it('gives the same names when the same source is built twice', () => {
    const root = scratch();
    build(root);
    const first = files(root);
    build(root);
    expect(files(root)).toEqual(first);
  });

  it('moves the script name on a one-byte edit and leaves the style name alone', () => {
    const root = scratch();
    build(root);
    const before = references(page(root));

    const link = join(root, 'web/connect/link.ts');
    writeFileSync(link, readFileSync(link, 'utf8').replace('= 110;', '= 111;'));
    expect(build(root)).toMatchObject({ status: 0 });
    const after = references(page(root));

    expect(after.script).not.toBe(before.script);
    expect(after.style).toBe(before.style);
  });

  it('removes what an earlier build left, so a stale file cannot ride along', () => {
    const root = scratch();
    mkdirSync(outputOf(root), { recursive: true });
    writeFileSync(join(outputOf(root), 'app-STALE123.js'), 'export {}');
    writeFileSync(join(outputOf(root), 'link.js'), 'export {}');
    expect(build(root)).toMatchObject({ status: 0 });
    expect(files(root)).not.toContain('app-STALE123.js');
    expect(files(root)).not.toContain('link.js');
  });

  it('carries the content security policy over byte for byte', () => {
    const root = scratch();
    build(root);
    const policy = (html: string) => html.match(/<meta[^>]*Content-Security-Policy[^>]*>/s)?.[0];
    const template = readFileSync(join(root, 'web/connect/index.html'), 'utf8');
    expect(policy(template)).toBeDefined();
    expect(policy(page(root))).toBe(policy(template));
  });

  it('refuses a template that does not load the entry script', () => {
    const root = scratch();
    const template = join(root, 'web/connect/index.html');
    writeFileSync(template, readFileSync(template, 'utf8').replace('boot.ts', 'missing.ts'));
    const result = build(root);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('index.html does not load boot.ts');
  });
});

/** The protocol range the engine renders into the page's schema input. */
const protocols = () => {
  const table = JSON.parse(readFileSync(join(ROOT, 'web/connect/methods.json'), 'utf8')) as {
    protocol: number;
    minProtocol: number;
  };
  return { max: table.protocol, min: table.minProtocol };
};

const builds = (root: string) =>
  JSON.parse(readFileSync(join(outputOf(root), 'builds.json'), 'utf8')) as {
    path: string;
    min: number;
    max: number;
  }[];

describe('connect page versioned builds', () => {
  it('publishes the current build also at the path of its newest protocol', () => {
    const root = scratch();
    expect(build(root)).toMatchObject({ status: 0 });
    const { max } = protocols();
    const versioned = join(outputOf(root), `v${max}`);

    const here = references(page(root));
    const there = references(readFileSync(join(versioned, 'index.html'), 'utf8'));
    expect(there).toEqual(here);
    for (const name of [here.script, here.style]) {
      expect(readFileSync(join(versioned, name))).toEqual(readFileSync(join(outputOf(root), name)));
    }
  });

  it('reaches the shared icon from the versioned page, one directory further up', () => {
    const root = scratch();
    build(root);
    const { max } = protocols();
    const icon = (html: string) => html.match(/<link rel="icon"[^>]*href="([^"]+)"/)?.[1];
    expect(icon(page(root))).toBe('../icon.png');
    expect(icon(readFileSync(join(outputOf(root), `v${max}`, 'index.html'), 'utf8'))).toBe(
      '../../icon.png'
    );
  });

  it('lists the current build with the range it speaks, for the page to find an older one', () => {
    const root = scratch();
    build(root);
    const { min, max } = protocols();
    expect(builds(root)).toEqual([{ path: `v${max}/`, min, max }]);
  });

  it('leaves no versioned build from an earlier run', () => {
    const root = scratch();
    mkdirSync(join(outputOf(root), 'v1'), { recursive: true });
    writeFileSync(join(outputOf(root), 'v1/index.html'), '<html></html>');
    build(root);
    expect(existsSync(join(outputOf(root), 'v1'))).toBe(false);
  });

  /** The scratch root as a repository, with its page committed under a name. */
  function committed(root: string): string {
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, env: gitFreeEnv(), encoding: 'utf8' }).trim();
    git('init', '-q');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    cpSync(BUILD, join(root, 'scripts/build-connect-page.mjs'));
    cpSync(join(ROOT, 'scripts/lib'), join(root, 'scripts/lib'), { recursive: true });
    git('add', 'web/connect', 'scripts', 'src', 'modules');
    git('commit', '-q', '-m', 'the page as it was');
    return git('rev-parse', 'HEAD');
  }

  it('builds each kept page from its commit at its own path, and lists it', () => {
    const root = scratch();
    const ref = committed(root);
    const link = join(root, 'web/connect/link.ts');
    writeFileSync(link, readFileSync(link, 'utf8').replace('= 110;', '= 111;'));
    writeFileSync(
      join(root, 'web/connect/kept.json'),
      JSON.stringify([{ path: 'v1/', min: 1, max: 1, ref }])
    );

    expect(build(root)).toMatchObject({ status: 0 });
    const kept = join(outputOf(root), 'v1');
    const keptScript = references(readFileSync(join(kept, 'index.html'), 'utf8')).script;
    expect(existsSync(join(kept, keptScript))).toBe(true);
    expect(keptScript).not.toBe(references(page(root)).script);
    expect(builds(root).map((entry) => entry.path)).toEqual([`v${protocols().max}/`, 'v1/']);
    expect(builds(root)[1]).toEqual({ path: 'v1/', min: 1, max: 1 });
  });

  it('fails when a kept page names a commit that does not exist', () => {
    const root = scratch();
    committed(root);
    writeFileSync(
      join(root, 'web/connect/kept.json'),
      JSON.stringify([{ path: 'v1/', min: 1, max: 1, ref: 'deadbeef' }])
    );
    const result = build(root);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('deadbeef');
  });

  it('refuses a kept page whose path would overwrite the current build', () => {
    const root = scratch();
    const ref = committed(root);
    writeFileSync(
      join(root, 'web/connect/kept.json'),
      JSON.stringify([{ path: `v${protocols().max}/`, min: 1, max: 1, ref }])
    );
    const result = build(root);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('already');
  });
});

describe('connect page locale chunks', () => {
  const locales = () => JSON.parse(readFileSync(join(I18N, 'locales/en-GB.json'), 'utf8'));

  /** The manifest the page carries: tag to chunk path. */
  function manifest(html: string): Record<string, string> {
    const raw = html.match(
      /<script type="application\/json" id="locale-chunks">([^<]*)<\/script>/
    )?.[1];
    if (!raw) throw new Error('the built page carries no locale manifest');
    return JSON.parse(raw);
  }

  const leaves = (value: unknown, prefix = ''): string[] =>
    value && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, child]) => leaves(child, `${prefix}${key}.`))
      : [prefix];

  it('emits one hashed chunk per supported locale, named by the page', () => {
    const root = scratch();
    expect(build(root)).toMatchObject({ status: 0 });
    const chunks = manifest(page(root));
    const { SUPPORTED_LOCALES } = jest.requireActual('../../i18n/types');
    expect(Object.keys(chunks).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    const held = readdirSync(join(outputOf(root), 'locales')).sort();
    expect(held).toEqual(
      Object.values(chunks)
        .map((path) => path.replace('locales/', ''))
        .sort()
    );
    for (const path of Object.values(chunks)) {
      expect(path).toMatch(/^locales\/[A-Za-z0-9-]+-[0-9a-f]{8,}\.json$/);
    }
  });

  it('holds only the page namespaces, and every key en-GB holds, in each chunk', () => {
    const root = scratch();
    build(root);
    const names: string[] = JSON.parse(
      readFileSync(join(ROOT, 'web/connect/namespaces.json'), 'utf8')
    );
    expect(names).toContain('connectPage');
    const expected = leaves(locales().connectPage).sort();
    for (const path of Object.values(manifest(page(root)))) {
      const chunk = JSON.parse(readFileSync(join(outputOf(root), path), 'utf8'));
      expect(Object.keys(chunk)).toEqual(names);
      // A language with more plural forms than English holds extra forms, never fewer keys.
      const base = (key: string) => key.replace(/_(zero|one|two|few|many|other)\.$/, '.');
      const own = new Set(leaves(chunk.connectPage).map(base));
      expect(expected.map(base).filter((key) => !own.has(key))).toEqual([]);
    }
  });

  it('names a chunk by its content, so an edited string moves only that locale', () => {
    const root = scratch();
    build(root);
    const before = manifest(page(root));
    const file = join(root, 'src/i18n/locales/fr.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('Non associé', 'Non lié'));
    build(root);
    const after = manifest(page(root));
    expect(after.fr).not.toBe(before.fr);
    expect(after.ja).toBe(before.ja);
  });
});

describe('connect page local guard on the build', () => {
  it('reads the versioned builds too, and fails a foreign import in one', () => {
    const root = scratch();
    build(root);
    expect(run(GUARD, ['--root', root])).toMatchObject({ status: 0 });
    const versioned = join(outputOf(root), `v${protocols().max}`);
    const { script } = references(readFileSync(join(versioned, 'index.html'), 'utf8'));
    writeFileSync(
      join(versioned, script),
      `import 'https://cdn.example.com/x.js';\n${readFileSync(join(versioned, script), 'utf8')}`
    );
    expect(run(GUARD, ['--root', root])).toMatchObject({ status: 1 });
  });

  it('passes the built output, and the template it was built from', () => {
    const root = scratch();
    build(root);
    expect(run(GUARD, ['--root', root])).toMatchObject({ status: 0 });
  });

  it('fails when the template gains a script from another origin', () => {
    const root = scratch();
    build(root);
    const template = join(root, 'web/connect/index.html');
    writeFileSync(
      template,
      readFileSync(template, 'utf8').replace(
        '</head>',
        '<script src="https://cdn.example.com/x.js"></script></head>'
      )
    );
    const result = run(GUARD, ['--root', root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain('cdn.example.com');
  });

  it('fails a built script that imports from another origin', () => {
    const root = scratch();
    build(root);
    const { script } = references(page(root));
    writeFileSync(
      join(outputOf(root), script),
      `import 'https://cdn.example.com/x.js';\n${readFileSync(join(outputOf(root), script), 'utf8')}`
    );
    expect(run(GUARD, ['--root', root])).toMatchObject({ status: 1 });
  });

  it('fails when there is no page to judge', () => {
    const root = mkdtempSync(join(tmpdir(), 'connect-empty-'));
    roots.push(root);
    expect(run(GUARD, ['--root', root])).toMatchObject({ status: 1 });
  });
});
