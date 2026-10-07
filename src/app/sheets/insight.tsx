import React from 'react';
import { router } from 'expo-router';

import { InsightDetailSheet } from '@/features/insights';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import type { Insight } from '@/types';

function InsightSheetContent() {
  const { input } = useSheetRequest<Insight, never>();
  if (!input) return null;

  return <InsightDetailSheet insight={input} onClose={() => router.back()} />;
}

export default withScreenBoundary(InsightSheetContent, 'Insight');
