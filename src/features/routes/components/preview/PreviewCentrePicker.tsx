/**
 * Horizontal picker of ranked riding areas. Each is the selector chip, carrying
 * the area's letter, in display order, plus the visit or section count that
 * ranked it, which a screen reader hears with its unit.
 *
 * The row runs off the screen on a phone, and a chip cut mid-word by the edge
 * reads as a layout bug rather than as more content. A fade sits over whichever
 * edge has content behind it, and neither is drawn before the first layout,
 * when there is nothing yet to say.
 */

import React, { useState } from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing } from '@/theme';
import { fallbackLetter } from '@/features/routes/lib/labelPreviewCentres';
import type { CentreLabel } from '@/features/routes/lib/labelPreviewCentres';
import type { PreviewCentre } from 'veloqrs';
import { ToggleButton } from '@/shared/ui';

interface PreviewCentrePickerProps {
  centres: PreviewCentre[];
  labels: CentreLabel[];
  selectedBinKey: string | null;
  onSelect: (centre: PreviewCentre) => void;
}

export function PreviewCentrePicker({
  centres,
  labels,
  selectedBinKey,
  onSelect,
}: PreviewCentrePickerProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const [offset, setOffset] = useState(0);

  // A hairline of slack: a content width a fraction over the viewport is a
  // rounding artefact, not a chip the athlete cannot see.
  const measured = viewport > 0 && content > 0;
  const overflows = measured && content > viewport + 1;
  const showStart = overflows && offset > 1;
  const showEnd = overflows && offset < content - viewport - 1;

  const fade = isDark ? darkColors.surfacePage : colors.surfacePage;
  const fadeStops = [fade, `${fade}00`] as const;

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        testID="preview-centre-picker"
        scrollEventThrottle={16}
        onLayout={(e: LayoutChangeEvent) => setViewport(e.nativeEvent.layout.width)}
        onContentSizeChange={(width: number) => setContent(width)}
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) =>
          setOffset(e.nativeEvent.contentOffset.x)
        }
      >
        {centres.map((centre, i) => {
          const active = centre.binKey === selectedBinKey;
          const label = t('settings.previewAreaFallback', {
            letter: labels[i]?.fallbackLetter ?? fallbackLetter(i),
          });
          const bySections = centre.source === 'sections';
          const count = bySections ? centre.sectionCount : centre.visitTotal;
          const detail = bySections
            ? t('settings.previewAreaSections', { count })
            : t('settings.previewAreaVisits', { count });
          return (
            <ToggleButton
              key={centre.binKey}
              label={label}
              count={count}
              selected={active}
              onPress={() => onSelect(centre)}
              accessibilityLabel={`${label}, ${detail}`}
              testID={`preview-centre-${centre.binKey}`}
            />
          );
        })}
        <View style={styles.tail} />
      </ScrollView>
      {showStart ? (
        <LinearGradient
          testID="preview-centre-fade-start"
          pointerEvents="none"
          colors={fadeStops}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fade, styles.fadeStart]}
        />
      ) : null}
      {showEnd ? (
        <LinearGradient
          testID="preview-centre-fade-end"
          pointerEvents="none"
          colors={fadeStops}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 0 }}
          style={[styles.fade, styles.fadeEnd]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  tail: { width: spacing.xs },
  fade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: spacing.lg,
  },
  fadeStart: { left: 0 },
  fadeEnd: { right: 0 },
});
