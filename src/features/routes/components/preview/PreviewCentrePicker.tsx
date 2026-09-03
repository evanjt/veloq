/**
 * Horizontal picker of ranked riding areas. Each chip carries the locality
 * label (or the numbered fallback) plus the visit or section count that
 * ranked it.
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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { colors, darkColors, brand, spacing, layout, typography } from '@/theme';
import type { CentreLabel } from '@/features/routes/lib/labelPreviewCentres';
import type { PreviewCentre } from '../../../../../modules/veloqrs/src/delegates/preview';

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
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const [offset, setOffset] = useState(0);

  // A hairline of slack: a content width a fraction over the viewport is a
  // rounding artefact, not a chip the athlete cannot see.
  const measured = viewport > 0 && content > 0;
  const overflows = measured && content > viewport + 1;
  const showStart = overflows && offset > 1;
  const showEnd = overflows && offset < content - viewport - 1;

  const fade = isDark ? darkColors.background : colors.background;
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
          const label =
            labels[i]?.label ??
            t('settings.previewAreaFallback', { number: labels[i]?.fallbackNumber ?? i + 1 });
          const detail =
            centre.source === 'sections'
              ? t('settings.previewAreaSections', { count: centre.sectionCount })
              : t('settings.previewAreaVisits', { count: centre.visitTotal });
          return (
            <Pressable
              key={centre.binKey}
              style={[
                styles.chip,
                { backgroundColor: surface, borderColor: border },
                active && styles.chipActive,
              ]}
              onPress={() => onSelect(centre)}
              testID={`preview-centre-${centre.binKey}`}
            >
              <Text
                style={[styles.chipLabel, { color: active ? colors.textOnDark : textPrimary }]}
                numberOfLines={1}
              >
                {label}
              </Text>
              <Text
                style={[styles.chipDetail, { color: active ? colors.textOnDark : textSecondary }]}
              >
                {detail}
              </Text>
            </Pressable>
          );
        })}
        <View style={styles.tail} />
      </ScrollView>
      {showStart && (
        <LinearGradient
          testID="preview-centre-fade-start"
          pointerEvents="none"
          colors={fadeStops}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fade, styles.fadeStart]}
        />
      )}
      {showEnd && (
        <LinearGradient
          testID="preview-centre-fade-end"
          pointerEvents="none"
          colors={fadeStops}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 0 }}
          style={[styles.fade, styles.fadeEnd]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  chip: {
    minWidth: 120,
    minHeight: 44,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: brand.tealLight,
    borderColor: brand.tealLight,
  },
  chipLabel: {
    ...typography.bodySmall,
    fontWeight: '600',
  },
  chipDetail: {
    ...typography.caption,
    marginTop: 2,
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
