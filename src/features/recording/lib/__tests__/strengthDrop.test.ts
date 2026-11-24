/**
 * Scenario: an exercise card is dragged and let go over the others in the session.
 * Expected behaviour: letting go over the middle of another card groups the two, over its
 * top or bottom edge moves the card there, and over itself or empty space changes nothing.
 */

import { dropPoint, resolveDrop, type CardBox } from '../strengthDrop';

// Three cards of 100 stacked with no gap: 0-100, 100-200, 200-300.
const BOXES: CardBox[] = [
  { top: 0, height: 100 },
  { top: 100, height: 100 },
  { top: 200, height: 100 },
];

describe('resolveDrop', () => {
  it('groups with the card it is let go over the middle of', () => {
    expect(resolveDrop(BOXES, 0, 150)).toEqual({ kind: 'Group', exercise: 0, to: 1 });
    expect(resolveDrop(BOXES, 2, 130)).toEqual({ kind: 'Group', exercise: 2, to: 1 });
  });

  it('moves to a card it is let go over the edge of', () => {
    expect(resolveDrop(BOXES, 0, 205)).toEqual({ kind: 'MoveExercise', exercise: 0, to: 2 });
    expect(resolveDrop(BOXES, 2, 195)).toEqual({ kind: 'MoveExercise', exercise: 2, to: 1 });
    expect(resolveDrop(BOXES, 2, 5)).toEqual({ kind: 'MoveExercise', exercise: 2, to: 0 });
  });

  it('changes nothing over itself, above the first card, below the last or with no cards', () => {
    expect(resolveDrop(BOXES, 1, 150)).toBeNull();
    expect(resolveDrop(BOXES, 1, -20)).toBeNull();
    expect(resolveDrop(BOXES, 1, 320)).toBeNull();
    expect(resolveDrop([], 0, 10)).toBeNull();
  });

  it('answers the card at the boundary below, so two cards never both claim a point', () => {
    expect(resolveDrop(BOXES, 2, 100)).toEqual({ kind: 'MoveExercise', exercise: 2, to: 1 });
  });

  it('groups a card dragged up onto the middle of the first card on a tall handset list', () => {
    const handset: CardBox[] = [
      { top: 393, height: 688 },
      { top: 1105, height: 1043 },
    ];
    const y = dropPoint(handset[1]!, -889, 0);
    expect(resolveDrop(handset, 1, y)).toEqual({ kind: 'Group', exercise: 1, to: 0 });
  });

  it('keeps the drop on the dragged card when the list scrolled under the finger', () => {
    const dragged = BOXES[2]!;
    expect(resolveDrop(BOXES, 2, dropPoint(dragged, -150, 150))).toBeNull();
  });

  it('ignores a card that has not been measured', () => {
    expect(resolveDrop([BOXES[0]!, undefined, BOXES[2]!], 0, 150)).toBeNull();
  });
});
