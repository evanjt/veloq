/**
 * Scenario: the bundled map renderer is below the release that sanitises
 * attribution HTML safely, so an attribution control mounted on any map page
 * is an HTML injection path into the page.
 *
 * Expected behaviour: the guard refuses a page that mounts one, by option or
 * by constructor, while the bundled version is below that release, and lets
 * it through from that release on.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../scripts/check-maplibre-attribution.mjs');
const RENDERER = 'src/features/maps/assets/maplibreRenderer.generated.ts';

function runGuard(version: string | null, pages: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'check-maplibre-attribution-'));
  try {
    const files: Record<string, string> = { ...pages };
    if (version !== null) {
      files[RENDERER] =
        `export const MAPLIBRE_GL_VERSION = '${version}';\n` +
        `export const MAPLIBRE_GL_JS_FILE = 'renderer/maplibre-gl-${version}.js';\n`;
    }
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    const result = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const page = (options: string) =>
  `export const html = \`<script>new maplibregl.Map({ container: 'map', ${options} });</script>\`;\n`;

describe('the attribution control guard', () => {
  it('passes pages that turn the control off', () => {
    const result = runGuard('5.19.0', {
      'src/features/maps/lib/htmlBuilders/trailPage.ts': page('attributionControl: false'),
    });

    expect(result.output).toBe('');
    expect(result.status).toBe(0);
  });

  it.each([
    ['turns it on', 'attributionControl: true'],
    ['passes it options', "attributionControl: { compact: true, customAttribution: 'Trail' }"],
    ['leaves the option to its default', 'center: [0, 0]'],
  ])('refuses a page that %s below the safe release', (_name, options) => {
    const result = runGuard('6.4.0', {
      'src/features/maps/lib/htmlBuilders/trailPage.ts': page(options),
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain('src/features/maps/lib/htmlBuilders/trailPage.ts');
  });

  it('refuses a control added by constructor, in a component as well as a builder', () => {
    const result = runGuard('5.19.0', {
      'src/features/maps/components/TrailMap.tsx':
        'const script = `window.map.addControl(new maplibregl.AttributionControl());`;\n',
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain('src/features/maps/components/TrailMap.tsx:1');
  });

  it('lets the control through from the safe release on', () => {
    const result = runGuard('6.4.1', {
      'src/features/maps/lib/htmlBuilders/trailPage.ts': page('attributionControl: true'),
    });

    expect(result.status).toBe(0);
  });

  it('refuses a tree whose bundled version it cannot read', () => {
    const result = runGuard(null, {
      'src/features/maps/lib/htmlBuilders/trailPage.ts': page('attributionControl: false'),
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain(RENDERER);
  });
});
