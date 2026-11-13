// Bundle today's page with a metafile and print where the bytes go, by top-level package or directory.
import { build } from 'esbuild';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const root = process.argv[2];
const r = await build({
  absWorkingDir: root,
  alias: {
    '@': join(root, 'src'),
    'veloqrs/src': join(root, 'modules/veloqrs/src'),
  },
  plugins: [
    {
      name: 'theme-subset',
      setup(b) {
        b.onResolve({ filter: /^@\/theme$/ }, () => ({
          path: join(root, 'web/connect/theme.ts'),
        }));
      },
    },
    {
      name: 'shims',
      setup(b) {
        const S = [
          [/^react-native$/, ['src/shared/format/format.ts'], 'reactNative.ts'],
          [/^expo-localization$/, ['src/shared/format/format.ts'], 'expoLocalization.ts'],
          [
            /^@\/i18n$/,
            ['src/shared/format/format.ts', 'src/shared/format/locale.ts'],
            'appI18n.ts',
          ],
          [/^@\/i18n\/localeBundles$/, ['src/i18n/resolveLocale.ts'], 'localeBundles.ts'],
        ];
        for (const [f, imps, shim] of S)
          b.onResolve({ filter: f }, (a) =>
            imps.some((i) => a.importer.endsWith('/' + i))
              ? { path: join(root, 'web/connect/shims', shim) }
              : undefined
          );
      },
    },
  ],
  entryPoints: [join('web/connect', 'boot.ts'), join('web/connect', 'connect.css')],
  outdir: join(tmpdir(), 'connect-bundle-breakdown'),
  bundle: true,
  splitting: true,
  format: 'esm',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  target: 'es2022',
  minify: true,
  metafile: true,
  write: true,
  logLevel: 'warning',
});
const by = new Map();
for (const [out, o] of Object.entries(r.metafile.outputs)) {
  if (!out.endsWith('.js')) continue;
  for (const [inp, i] of Object.entries(o.inputs)) {
    const m = inp.match(/node_modules\/((@[^/]+\/)?[^/]+)/);
    const key = m ? 'pkg ' + m[1] : inp.split('/').slice(0, 3).join('/');
    by.set(key, (by.get(key) ?? 0) + i.bytesInOutput);
  }
}
for (const [k, v] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 25))
  console.log(String(v).padStart(8), k);
