import React from 'react';

import { StrengthPairsInfoSheet } from '@/features/strength';
import { useTheme } from '@/shared/app';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

/** What the strength balance pairs are and when one is flagged, a sheet route with no input and no result. */

function StrengthPairsInfoSheetContent() {
  const { isDark } = useTheme();
  return <StrengthPairsInfoSheet isDark={isDark} />;
}

export default withScreenBoundary(StrengthPairsInfoSheetContent, 'Strength Pairs Info');
