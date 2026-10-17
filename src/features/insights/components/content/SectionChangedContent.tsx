import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { tapTo } from '@/shared/app/navigation';
import { pressable, pressRipple } from '@/shared/ui';
import { TrackPreview, normaliseTrackPoints } from '@/shared/ui/TrackPreview';
import { insightCategoryColor } from '@/theme';
import type { Insight, TFunc } from '../../types';
import { dataLinkLabel } from '../../lib/dataLink';

const DRAWING_HEIGHT = 150;

interface SectionChangedContentProps {
  insight: Insight;
}

/**
 * The section that changed, drawn at the sheet's width in the card's colour,
 * opening the section. The card draws this line, so the sheet it opens does
 * too rather than showing less than the card.
 */
export const SectionChangedContent = React.memo(function SectionChangedContent({
  insight,
}: SectionChangedContentProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(Math.round(event.nativeEvent.layout.width));
  }, []);

  const history = insight.supportingData?.history;
  const line = history?.kind === 'line' ? history : undefined;
  const points = useMemo(() => normaliseTrackPoints(line?.points ?? []), [line]);
  const target = line?.target;
  const onPress = useCallback(() => {
    if (target) tapTo(target);
  }, [target]);

  if (!line || points.length < 2) return null;

  return (
    <Pressable
      testID="section-changed-link"
      accessibilityRole="link"
      accessibilityLabel={dataLinkLabel(insight, target, t as unknown as TFunc)}
      onPress={onPress}
      android_ripple={pressRipple}
      style={pressable()}
    >
      <View style={styles.drawing} onLayout={onLayout}>
        {width > 0 ? (
          <TrackPreview
            testID="section-changed-line"
            points={points}
            color={insightCategoryColor(insight.category, isDark)}
            isDark={isDark}
            width={width}
            height={DRAWING_HEIGHT}
          />
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  drawing: {
    height: DRAWING_HEIGHT,
  },
});
