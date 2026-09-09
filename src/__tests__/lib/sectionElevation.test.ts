/**
 * Scenario: the engine records gain and loss for every enriched section, but the
 * cards only ever read gain, so a descent showed no vertical at all.
 * Expected behaviour: the dominant side is chosen, and a section with nothing
 * worth showing stays silent.
 */

import { sectionElevation } from '@/features/routes/lib/sectionElevation';

describe('sectionElevation', () => {
  it('says nothing when the section carries no elevation', () => {
    expect(sectionElevation({})).toBeUndefined();
  });

  it('says nothing when both sides sit under the floor', () => {
    expect(
      sectionElevation({ elevationGainM: 4, elevationLossM: 6, klass: 'flat' })
    ).toBeUndefined();
  });

  it('reports the gain on a climb', () => {
    expect(sectionElevation({ elevationGainM: 420, elevationLossM: 15, klass: 'climb' })).toEqual({
      metres: 420,
      direction: 'gain',
    });
  });

  it('reports the loss on a descent', () => {
    expect(sectionElevation({ elevationGainM: 12, elevationLossM: 640, klass: 'descent' })).toEqual(
      {
        metres: 640,
        direction: 'loss',
      }
    );
  });

  it('falls back to the gain when a descent has no loss recorded', () => {
    expect(sectionElevation({ elevationGainM: 55, klass: 'descent' })).toEqual({
      metres: 55,
      direction: 'gain',
    });
  });

  it('takes the larger side when nothing classed the line', () => {
    expect(sectionElevation({ elevationGainM: 30, elevationLossM: 210 })).toEqual({
      metres: 210,
      direction: 'loss',
    });
  });

  it('holds the chosen side to the floor rather than swapping to the other', () => {
    expect(
      sectionElevation({ elevationGainM: 3, elevationLossM: 400, klass: 'climb' })
    ).toBeUndefined();
  });

  it('gives the same answer on a second call', () => {
    const section = { elevationGainM: 12, elevationLossM: 640, klass: 'descent' };
    expect(sectionElevation(section)).toEqual(sectionElevation(section));
  });
});
