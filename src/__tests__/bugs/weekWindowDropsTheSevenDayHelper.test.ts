/**
 * Scenario: `lastSevenDaysWindow` existed for the week-shape card's engine
 * read, and the card went with B1104.
 * Expected behaviour: the helper, its type and its barrel export are gone, and
 * the week anchors the other screens use stay.
 */

import * as fs from 'fs';
import * as path from 'path';

const FITNESS = path.resolve(__dirname, '../../features/fitness');

describe('the week window carries no seven-day helper', () => {
  const source = fs.readFileSync(path.join(FITNESS, 'lib/weekWindow.ts'), 'utf8');

  it('no longer defines it', () => {
    expect(source).not.toMatch(/lastSevenDaysWindow|WeekWindow/);
  });

  it('no longer exports it from the feature barrel', () => {
    const barrel = fs.readFileSync(path.join(FITNESS, 'index.ts'), 'utf8');

    expect(barrel).not.toMatch(/lastSevenDaysWindow/);
  });

  it('keeps the anchors the fitness and home weeks are built from', () => {
    expect(source).toMatch(/export function mondayAnchors/);
    expect(source).toMatch(/export function weekAnchorSeconds/);
    expect(source).toMatch(/export function currentAndPreviousWeek/);
  });
});
