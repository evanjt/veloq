import fs from 'fs';
import path from 'path';

const dir = path.join(__dirname, '../../i18n/locales');

describe('locale files never call a section a segment', () => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

  it.each(files)('%s has no value containing "segment"', (file) => {
    const hits: string[] = [];
    const walk = (node: unknown, trail: string) => {
      if (typeof node === 'string') {
        if (/segment/i.test(node)) hits.push(`${trail}: ${node}`);
      } else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) walk(v, `${trail}.${k}`);
      }
    };
    walk(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')), file);
    expect(hits).toEqual([]);
  });
});
