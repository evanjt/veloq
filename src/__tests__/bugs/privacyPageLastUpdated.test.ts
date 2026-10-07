import { readFileSync } from 'fs';
import { join } from 'path';

const html = readFileSync(join(__dirname, '../../../docs/privacy/index.html'), 'utf8');

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
  janvier: 1,
  février: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  août: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  décembre: 12,
};

function parseDay(text: string): string {
  const m = text.match(/(\d{1,2})(?:er)? (?:de )?([\p{L}]+)(?: de)? (\d{4})/u);
  if (!m) throw new Error(`no date in "${text}"`);
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) throw new Error(`unknown month in "${text}"`);
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

describe('privacy page "Last updated" date', () => {
  it('names the same day in the markup and in every translation', () => {
    const markup = html.match(/class="last-updated"[^>]*>\s*([^<]+?)\s*</)?.[1];
    const translated = [...html.matchAll(/lastUpdated:\s*"([^"]+)"/g)].map((m) => m[1]);

    expect(markup).toBeDefined();
    expect(translated).toHaveLength(3);
    const days = new Set([markup!, ...translated].map(parseDay));
    expect([...days]).toHaveLength(1);
  });

  it('is no earlier than the last rewrite of the security claims', () => {
    const markup = html.match(/class="last-updated"[^>]*>\s*([^<]+?)\s*</)![1];
    expect(parseDay(markup) >= '2026-10-06').toBe(true);
  });
});
