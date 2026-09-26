/**
 * Scenario: the WebView interceptor answers `/veloq-tile/<source>/<z>/<x>/<y>.<ext>`
 * out of the Rust store and has to name a content type for the bytes.
 *
 * Expected behaviour: the type comes from the extension the page asked for, which
 * is the upstream template's own. It used to come from the source name, matching
 * a `vector` and a `terrain` prefix that no source in the app is named, so every
 * tile including the vector basemap was answered `image/jpeg`.
 */

import fs from 'fs';
import path from 'path';

import { SATELLITE_SOURCES } from '@/features/maps/components/mapStyles';
import { LIBERTY_SOURCES } from '@/features/maps/styles/liberty/sources';

const projectRoot = path.join(__dirname, '../../..');
const CLIENT = fs.readFileSync(
  path.join(
    projectRoot,
    'modules/veloqrs/android/src/main/java/com/veloq/VeloqTileWebViewClient.java'
  ),
  'utf8'
);

/** The `case "<ext>":` labels that fall through to one `return "<mime>";`. */
function typeTable(java: string): Record<string, string> {
  const table: Record<string, string> = {};
  let pending: string[] = [];
  for (const line of java.split('\n')) {
    const label = line.match(/case\s+"([a-z0-9]+)":/);
    if (label) {
      pending.push(label[1]);
      continue;
    }
    const answer = line.match(/return\s+"([a-z-]+\/[a-z0-9.+-]+)";/);
    if (answer && pending.length) {
      for (const ext of pending) table[ext] = answer[1];
      pending = [];
    }
  }
  return table;
}

describe('the interceptor types a tile from its extension', () => {
  it('reads the extension off the path rather than the source name', () => {
    expect(CLIENT).not.toMatch(/source\.startsWith\(/);
    expect(CLIENT).toMatch(/mimeFor\(extension\)/);
  });

  it('names every extension the basemap sources ask for', () => {
    expect(typeTable(CLIENT)).toMatchObject({
      pbf: 'application/x-protobuf',
      mvt: 'application/x-protobuf',
      png: 'image/png',
      webp: 'image/webp',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
    });
  });

  it('falls back to imagery, which is what a template naming no extension is', () => {
    expect(CLIENT).toMatch(/default:\s*\n\s*return "image\/jpeg";/);
  });
});

describe('the source names the old match needed', () => {
  it('belongs to no source in the app, so every tile was typed as imagery', () => {
    const keys = [...Object.keys(SATELLITE_SOURCES), ...Object.keys(LIBERTY_SOURCES)];
    expect(keys.length).toBeGreaterThan(5);
    expect(keys.filter((k) => k.startsWith('vector') || k.startsWith('terrain'))).toEqual([]);
  });
});
