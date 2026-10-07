/**
 * Shared types for activity stats components.
 */

import type { ComponentProps } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface StatDetail {
  title: string;
  value: string;
  icon: IconName;
  color: string;
  context?: string | undefined;
  details?: { label: string; value: string }[] | undefined;
  explanation?: string | undefined;
}
