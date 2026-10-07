/**
 * Scenario: the athlete picks the Run chip, then the only run on the section
 * is deleted. The engine answers a sport the section has never seen with
 * nothing, and with one sport left no pills are drawn, so nothing on screen
 * can clear the chip.
 *
 * Expected behaviour: a chip the screen read no longer offers is not offered,
 * so the screen hands the choice back to the engine's default.
 */

import { isSportOffered } from '@/features/routes/lib/sectionSport';

describe('isSportOffered', () => {
  const counts = [
    { sportType: 'Ride', count: 4 },
    { sportType: 'Walk', count: 0 },
  ];

  it('offers a sport the section has a pill for, at any count', () => {
    expect(isSportOffered('Ride', counts)).toBe(true);
    expect(isSportOffered('Walk', counts)).toBe(true);
  });

  it('does not offer a sport the section has no pill for', () => {
    expect(isSportOffered('Run', counts)).toBe(false);
    expect(isSportOffered('Run', [])).toBe(false);
  });
});
