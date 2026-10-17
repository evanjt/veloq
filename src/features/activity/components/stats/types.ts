/**
 * Shared types for activity stats components.
 */

import type { ComponentProps } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** A recorded stream a stat can name, keyed on the tile in that stream's chart colour. */
export type StatStream = 'power' | 'heartrate' | 'speed' | 'pace' | 'cadence';

export interface StatDetail {
  title: string;
  value: string;
  /** The unit the value is read in, drawn beside it; a count or a score has none. */
  unit?: string | undefined;
  icon: IconName;
  /**
   * The stream the stat measures, when it measures one. It draws a key dot in
   * the stream's colour; the icon itself always takes the secondary ink.
   */
  stream?: StatStream | undefined;
  context?: string | undefined;
  details?: { label: string; value: string }[] | undefined;
  explanation?: string | undefined;
}
