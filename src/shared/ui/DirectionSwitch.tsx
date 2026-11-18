/**
 * The switch between the two directions a section or route is ridden in.
 *
 * A segmented track with one segment per direction, each its word and how
 * many attempts it holds (see `SegmentedSwitch`). It is not a row of selector
 * chips, so it never reads as a second row of the plot toggle that sits above
 * it on the same card.
 *
 * The counts are the engine's and the colours the direction pair, both handed
 * in by the caller, so the switch counts and colours nothing itself. With
 * either direction empty there is nothing to switch between, and it draws
 * nothing.
 */

import React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SegmentedSwitch } from './SegmentedSwitch';

export type SwitchDirection = 'forward' | 'reverse';

const DIRECTIONS: readonly SwitchDirection[] = ['forward', 'reverse'];

const LABEL_KEYS = {
  forward: 'sections.forward',
  reverse: 'sections.reverse',
} as const;

export interface DirectionSwitchProps {
  value: SwitchDirection;
  /** Attempts per direction, as the engine counts them. */
  counts: Record<SwitchDirection, number>;
  /** The colour each direction is drawn in on the page. */
  marks: Record<SwitchDirection, string>;
  onChange: (direction: SwitchDirection) => void;
  /** The track's id; each segment is `${testID}-${direction}`. */
  testID: string;
  style?: StyleProp<ViewStyle>;
}

export function DirectionSwitch({
  value,
  counts,
  marks,
  onChange,
  testID,
  style,
}: DirectionSwitchProps) {
  const { t } = useTranslation();

  if (counts.forward <= 0 || counts.reverse <= 0) return null;

  return (
    <SegmentedSwitch<SwitchDirection>
      value={value}
      options={DIRECTIONS.map((direction) => ({
        value: direction,
        label: t(LABEL_KEYS[direction]),
        count: counts[direction],
        mark: marks[direction],
      }))}
      onChange={onChange}
      testID={testID}
      style={style}
    />
  );
}
