import React from 'react';

import { InsightDetailSheet } from '@/features/insights';
import { goBack } from '@/shared/app/navigation';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import type { Insight } from '@/types';

function InsightSheetContent() {
  const { input } = useSheetRequest<Insight, never>();
  if (!input) return null;

  return <InsightDetailSheet insight={input} onClose={goBack} />;
}

export default withScreenBoundary(InsightSheetContent, 'Insight');
