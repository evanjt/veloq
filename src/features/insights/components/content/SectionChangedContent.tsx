import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { navigateTo } from '@/shared/app/navigation';
import { fromInsightsPath } from '@/shared/app/sectionOrigin';
import { PressTarget } from '@/shared/ui';
import type { Insight, TFunc } from '../../types';
import { dataLinkLabel } from '../../lib/dataLink';
import { SheetTrackDrawing } from './SheetTrackDrawing';

interface SectionChangedContentProps {
  insight: Insight;
}

/**
 * The section that changed, drawn at the sheet's width in the card's graphic colour,
 * opening the section. The card draws this line, so the sheet it opens does
 * too rather than showing less than the card.
 */
export const SectionChangedContent = React.memo(function SectionChangedContent({
  insight,
}: SectionChangedContentProps) {
  const { t } = useTranslation();

  const history = insight.supportingData?.history;
  const line = history?.kind === 'line' ? history : undefined;
  const target = line?.target;
  const onPress = useCallback(() => {
    if (target) navigateTo(fromInsightsPath(target));
  }, [target]);

  const drawable = line?.points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!line || !drawable || drawable.length < 2) return null;

  return (
    <PressTarget
      testID="section-changed-link"
      accessibilityRole="link"
      accessibilityLabel={dataLinkLabel(insight, target, t as unknown as TFunc)}
      onPress={onPress}
    >
      <SheetTrackDrawing testID="section-changed-line" points={line.points} />
    </PressTarget>
  );
});
