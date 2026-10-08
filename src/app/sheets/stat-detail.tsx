import React from 'react';

import { StatDetailSheet, type StatDetail } from '@/features/activity';
import { useTheme } from '@/shared/app';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

/** The detail of a tapped activity stat, a sheet route that presents its input and returns nothing. */

function StatDetailSheetContent() {
  const { isDark } = useTheme();
  const { input } = useSheetRequest<StatDetail, never>();
  if (!input) return null;

  return <StatDetailSheet stat={input} isDark={isDark} />;
}

export default withScreenBoundary(StatDetailSheetContent, 'Stat Detail');
