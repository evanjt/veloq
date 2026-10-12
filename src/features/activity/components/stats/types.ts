/**
 * Shared types for activity stats components.
 */

import type { ComponentProps } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface StatDetail {
  title: string;
  value: string;
  /** The unit the value is read in, drawn beside it; a count or a score has none. */
  unit?: string | undefined;
  icon: IconName;
  color: string;
  context?: string | undefined;
  details?: { label: string; value: string }[] | undefined;
  explanation?: string | undefined;
}
