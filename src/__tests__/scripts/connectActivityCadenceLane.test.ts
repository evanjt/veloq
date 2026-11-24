/**
 * Scenario: the activity chart draws a cadence lane for a sport whose cadence
 * is steps or strokes a minute, not revolutions.
 *
 * Expected behaviour: the lane's unit follows the activity's cadence unit,
 * `spm` for steps and strokes a minute and `rpm` for revolutions or when the
 * unit is not known yet. Other lanes keep their own units.
 */

import { lanesFor } from '../../../web/connect/pages/ActivityPage';

const unitOf = (unit: Parameters<typeof lanesFor>[0], key: string) =>
  lanesFor(unit).find((lane) => lane.key === key)?.unit;

describe('cadence lane unit', () => {
  it.each([
    ['stepsPerMinute', 'spm'],
    ['strokesPerMinute', 'spm'],
    ['rpm', 'rpm'],
    [undefined, 'rpm'],
  ] as const)('%s reads %s', (unit, label) => {
    expect(unitOf(unit, 'cadence')).toBe(label);
  });

  it('leaves the other lanes alone', () => {
    expect(unitOf('stepsPerMinute', 'watts')).toBe('W');
  });
});
