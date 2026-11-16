import type { LiveStrengthEdit } from 'veloqrs';

/** Where an exercise card sits in the list, in the list's own coordinates. */
export interface CardBox {
  top: number;
  height: number;
}

/** The share of a card, from its middle outwards, in which a drop groups rather than moves. */
const GROUP_BAND = 0.5;

/**
 * The change letting go of exercise `from` at `y` asks for. Over the middle of another card the
 * two are grouped; over its top or bottom edge the exercise moves to that card's place. Over
 * itself, past either end of the list or over a card not yet measured, nothing changes.
 *
 * A boundary between two cards belongs to the lower one, so no point is claimed twice.
 */
export function resolveDrop(
  boxes: readonly (CardBox | undefined)[],
  from: number,
  y: number
): LiveStrengthEdit | null {
  const target = boxes.findIndex((box) => box && y >= box.top && y < box.top + box.height);
  const box = boxes[target];
  if (target < 0 || target === from || !box) return null;
  const fromMiddle = Math.abs(y - (box.top + box.height / 2)) / box.height;
  return fromMiddle < GROUP_BAND / 2
    ? { kind: 'Group', exercise: from, to: target }
    : { kind: 'MoveExercise', exercise: from, to: target };
}
