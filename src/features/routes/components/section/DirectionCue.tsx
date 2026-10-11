/**
 * The cue that names a section direction: an arrow glyph and the Forward or
 * Reverse word. Each direction also has a colour, and colour never carries the
 * direction on its own.
 */

import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { TFunction } from 'i18next';

export type SectionDirection = 'forward' | 'reverse';

export function directionWord(t: TFunction, direction: SectionDirection): string {
  return direction === 'forward' ? t('sections.forward') : t('sections.reverse');
}

export function DirectionArrow({
  direction,
  color,
  size = 14,
}: {
  direction: SectionDirection;
  color: string;
  size?: number;
}) {
  return (
    <MaterialCommunityIcons
      name={direction === 'forward' ? 'arrow-right' : 'arrow-left'}
      size={size}
      color={color}
    />
  );
}
