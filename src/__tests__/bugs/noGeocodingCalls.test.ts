/**
 * US-GEO1 static regression: no production code may import the Nominatim
 * geocoding helpers. They were disabled for Nominatim ToS compliance
 * (v0.3.0, see `src/lib/geo/geocoding.ts` header). The module is still
 * present for tests and future use (when a caching proxy is in place) but
 * must not be called from a shipping code path.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const EXPORT_NAMES = ['reverseGeocode', 'generateRouteName'] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const s = statSync(path);
    if (s.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === '.expo') continue;
      walk(path, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

describe('US-GEO1: no Nominatim geocoding calls in production code', () => {
  it('reverseGeocode / generateRouteName are not imported from production code', () => {
    const files = walk(ROOT);
    const violations: string[] = [];

    for (const file of files) {
      if (file.endsWith('src/lib/geo/geocoding.ts')) continue;
      const src = readFileSync(file, 'utf8');
      for (const name of EXPORT_NAMES) {
        const importRegex = new RegExp(
          `import\\s+\\{[^}]*\\b${name}\\b[^}]*\\}\\s+from\\s+['"][^'"]*geocoding['"]`
        );
        if (importRegex.test(src)) {
          violations.push(`${file}: imports ${name}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
