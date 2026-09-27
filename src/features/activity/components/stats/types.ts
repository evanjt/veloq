/**
 * Shared types for activity stats components.
 */

import type { ComponentProps } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface StatComparison {
  label: string;
  value: string;
  trend: 'up' | 'down' | 'same';
  isGood?: boolean | undefined;
}

export interface StatDetail {
  title: string;
  value: string;
  icon: IconName;
  color: string;
  comparison?: StatComparison | undefined;
  context?: string | undefined;
  details?: { label: string; value: string }[] | undefined;
  explanation?: string | undefined;
}
