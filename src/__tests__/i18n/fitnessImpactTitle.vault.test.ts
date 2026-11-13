import fs from 'fs';
import { resolvedLocale } from './resolvedLocale';
import path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');
const stripUnit = (label: string) =>
  label
    .replace(/\s*[(（].*$/, '')
    .trim()
    .toLowerCase();

describe('fitness impact card title', () => {
  // The card's headline is the activity's addition to fitness, so a title built on the form (TSB)
  // word reads a ride as raising form when its form row falls.
  const files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));

  it.each(files)('%s names fitness, not form', (file) => {
    const stats = resolvedLocale(file.replace('.json', '')).activity.stats;
    const title: string = stats.fitnessImpact;
    const formStem = Array.from(stripUnit(stats.formTSB)).slice(0, 4).join('');
    const fitnessName = stripUnit(stats.fitnessCTL);
    const lower = title.toLowerCase();

    const namesFitness = lower.includes(fitnessName) || title.includes('(CTL)');
    expect(lower.includes(formStem) && !namesFitness).toBe(false);
  });
});
