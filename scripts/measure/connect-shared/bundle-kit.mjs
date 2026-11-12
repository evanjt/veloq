// Bundle a scratch entry under scripts/measure/connect-shared/ with react-native resolved to
// react-native-web, and report output sizes, where the bytes go, and the shortest import chain
// from the entry to each package named in CHAINS.
//
//   node bundle-kit.mjs <repo root> <scratch dir holding node_modules/react-native-web> [entry] [out]
//   SHIMS=src/shared/ui/Icon.tsx=icon.ts,...   source files replaced by a file under ./shims
//   EXTERNAL=pkg,pkg                            packages left out of the bundle
//   CHAINS=pkg,pkg                              packages whose import chain is printed
import { build } from 'esbuild';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';

const root = process.argv[2];
const deps = process.argv[3];
const entry = process.argv[4] ?? 'entry-kit.tsx';
const out = process.argv[5] ?? join(tmpdir(), 'connect-kit-bundle');
const here = join(root, 'scripts/measure/connect-shared');
const shims = new Map(
  (process.env.SHIMS ?? '')
    .split(',')
    .filter(Boolean)
    .map((pair) =>
      pair.split('=').map((s, i) => (i === 0 ? join(root, s) : join(here, 'shims', s)))
    )
);
const list = (name) => (process.env[name] ?? '').split(',').filter(Boolean);
// PKG_SHIMS=react-native-paper=paper.ts,...  bare package specifiers replaced by a file under ./shims
const pkgShims = new Map(
  list('PKG_SHIMS')
    .map((pair) => pair.split('='))
    .map(([k, v]) => [k, join(here, 'shims', v)])
);

/** Exact-case resolution: esbuild matches directory entries case-insensitively and this tree
 * holds pairs such as chartMarks.ts beside ChartMarks.tsx. Shimmed files are swapped here too. */
function exact(base) {
  // Platform files first, as Metro resolves them for web.
  for (const ext of [
    '.web.ts',
    '.web.tsx',
    '.web.js',
    '',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.json',
    '/index.web.js',
    '/index.ts',
    '/index.tsx',
    '/index.js',
  ]) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile())
      return shims.get(candidate) ?? candidate;
  }
  return undefined;
}

try {
  const r = await build({
    absWorkingDir: root,
    alias: {
      // One React: the scratch install carries its own copy as a peer of react-native-web.
      react: join(root, 'node_modules/react'),
      'react-dom': join(root, 'node_modules/react-dom'),
      'react-native': join(deps, 'node_modules/react-native-web'),
      'react-native-web': join(deps, 'node_modules/react-native-web'),
      // Expo's web bundler maps this one path the same way.
      'react-native/Libraries/Image/AssetRegistry': join(
        root,
        'node_modules/@react-native/assets-registry/registry.js'
      ),
    },
    plugins: [
      {
        name: 'exact-paths',
        setup(b) {
          for (const [pkg, path] of pkgShims)
            b.onResolve({ filter: new RegExp('^' + pkg.replace(/[/@.]/g, '\\$&') + '$') }, () => ({
              path,
            }));
          b.onResolve({ filter: /^(\.\.?\/|@\/)/ }, (a) => {
            const base = a.path.startsWith('@/')
              ? join(root, 'src', a.path.slice(2))
              : resolvePath(a.resolveDir, a.path);
            const path = exact(base);
            return path ? { path } : undefined;
          });
        },
      },
    ],
    external: list('EXTERNAL'),
    entryPoints: [join(here, entry)],
    outdir: out,
    bundle: true,
    format: 'esm',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
    target: 'es2022',
    minify: process.env.MINIFY !== '0',
    metafile: true,
    write: true,
    logLevel: 'silent',
    loader: { '.ttf': 'file', '.png': 'file', '.js': 'jsx' },
  });
  for (const f of readdirSync(out)) {
    const bytes = readFileSync(join(out, f));
    console.log(
      String(bytes.length).padStart(9),
      String(gzipSync(bytes, { level: 9 }).length).padStart(9),
      f
    );
  }
  const by = new Map();
  for (const [o, m] of Object.entries(r.metafile.outputs)) {
    if (!o.endsWith('.js')) continue;
    for (const [i, v] of Object.entries(m.inputs)) {
      const pkg = i.match(/node_modules\/((@[^/]+\/)?[^/]+)/);
      const key = pkg ? 'pkg ' + pkg[1] : i.split('/').slice(0, 3).join('/');
      by.set(key, (by.get(key) ?? 0) + v.bytesInOutput);
    }
  }
  for (const [k, v] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 30))
    console.log(String(v).padStart(8), k);
  const inputs = r.metafile.inputs;
  const parents = new Map();
  const start = Object.keys(inputs).find((k) => k.endsWith(entry));
  const queue = [start];
  parents.set(start, null);
  while (queue.length) {
    const cur = queue.shift();
    for (const imp of inputs[cur]?.imports ?? []) {
      if (!parents.has(imp.path)) {
        parents.set(imp.path, cur);
        queue.push(imp.path);
      }
    }
  }
  for (const pkg of list('CHAINS')) {
    const hit = [...parents.keys()].find(
      (k) => k.includes('node_modules/' + pkg + '/') || k === pkg || k.startsWith(pkg + '/')
    );
    if (!hit) {
      console.log('chain', pkg, ': not in graph');
      continue;
    }
    const chain = [];
    for (let c = hit; c; c = parents.get(c)) chain.unshift(c.replace(/^.*node_modules\//, 'nm:'));
    console.log('chain', pkg, ':\n   ' + chain.join('\n   '));
  }
} catch (e) {
  const seen = new Set();
  for (const err of e.errors ?? [{ text: e.message }]) {
    const m = /Could not resolve "([^"]+)"/.exec(err.text);
    const k = (m ? m[1] : err.text) + '  <- ' + (err.location?.file ?? '');
    if (!seen.has(k)) {
      seen.add(k);
      console.log(k);
    }
  }
}
