import React, { useCallback, useState } from 'react';
import { I18nManager, ScrollView, View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import { DenseText } from '@/shared/ui/DenseText';
import { useTheme } from '@/shared/app';
import { chipFrame, selectedChipPaint, PressTarget, usePagerScrollerGesture } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { useTranslation } from 'react-i18next';
import {
  chartStreamColour,
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  layout,
  slopToMinTapTarget,
  spacing,
  stroke,
  typography,
} from '@/theme';
import { chartTypeLabel, type ChartConfig } from '@/features/activity/lib/chartConfig';

interface ChartTypeSelectorProps {
  /** Available chart types (only those with data) */
  available: ChartConfig[];
  /** Currently selected chart type IDs */
  selected: string[];
  /** Toggle a chart type on/off */
  onToggle: (id: string) => void;
  /** The ground the row sits on, which its trailing fade blends into; a card's by default. */
  ground?: string | undefined;
  /** Centre the chips while they fit, as the full screen view lays them out. */
  centred?: boolean | undefined;
}

/**
 * The activity streams' toggles, which are also their legend: one chip per
 * stream on one line, keyed by a short line in its colour and named in the
 * text colour. A tap draws or removes its lane, and each lane carries its own
 * value. The row scrolls sideways when the chips overflow it, and the tab
 * pager waits on it, so a swipe on the row scrolls the row.
 */
export function ChartTypeSelector({
  available,
  selected,
  onToggle,
  ground,
  centred = false,
}: ChartTypeSelectorProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const palette = isDark ? darkColors : colors;
  const fadeGround = ground ?? (isDark ? darkColors.surfaceRaised : colors.surface);
  const scroller = usePagerScrollerGesture();
  const isRTL = I18nManager.isRTL;

  // The fade says there is more to scroll to, so it is drawn only when the chips overflow.
  const [viewportWidth, setViewportWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const onViewportLayout = useCallback(
    (event: LayoutChangeEvent) => setViewportWidth(event.nativeEvent.layout.width),
    []
  );
  const onContentSizeChange = useCallback((width: number) => setContentWidth(width), []);
  const overflows = viewportWidth > 0 && contentWidth > viewportWidth;

  if (available.length === 0) {
    return null;
  }

  return (
    <View style={styles.frame} onLayout={onViewportLayout}>
      <GestureDetector gesture={scroller}>
        <ScrollView
          testID="chart-type-selector"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.row, centred && styles.rowCentred]}
          onContentSizeChange={onContentSizeChange}
        >
          {available.map((config) => {
            const isSelected = selected.includes(config.id);
            // Selected, the chip is the app's selected chip, whose ink clears 4.5:1
            // on its fill where a stream hue under any one ink does not. Unselected,
            // it is the neutral control ground under the primary text. Chart text
            // never sits on a stream colour: the line key says which stream it is.
            const frame = chipFrame(isSelected, isDark, palette.fillNeutral);
            const textColor = isSelected ? selectedChipPaint(isDark).ink : palette.textPrimary;
            const label = chartTypeLabel(config, t);

            return (
              <PressTarget
                key={config.id}
                testID={`chart-type-${config.id}`}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: isSelected }}
                style={[styles.chip, frame]}
                hitSlop={CHIP_SLOP}
                onPress={() => onToggle(config.id)}
              >
                <View
                  testID={`chart-type-${config.id}-key`}
                  style={[
                    styles.chipKey,
                    { backgroundColor: chartStreamColour(config.stream, isDark) },
                  ]}
                />
                <Icon name={config.icon} size={iconSize.xs} color={textColor} />
                <DenseText style={[styles.chipLabel, { color: textColor }]}>{label}</DenseText>
              </PressTarget>
            );
          })}
        </ScrollView>
      </GestureDetector>
      {overflows ? (
        <LinearGradient
          testID="chart-type-selector-fade"
          colors={[colorWithOpacity(fadeGround, 0), fadeGround]}
          start={{ x: isRTL ? 1 : 0, y: 0 }}
          end={{ x: isRTL ? 0 : 1, y: 0 }}
          style={styles.trailingFade}
          pointerEvents="none"
        />
      ) : null}
    </View>
  );
}

// The chips sit on one line, so each is drawn at its content's height and
// reaches the tap target through slop.
export const CHIP_HEIGHT = typography.label.lineHeight + 2 * spacing.xs + 2 * stroke.one;
const CHIP_SLOP = slopToMinTapTarget(CHIP_HEIGHT);

const styles = StyleSheet.create({
  frame: {
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsPlus,
  },
  rowCentred: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: CHIP_HEIGHT,
    borderRadius: layout.borderRadius,
  },
  // A short stroke of the stream's line, so the chip keys its lane as a legend does.
  chipKey: {
    width: spacing.md,
    height: stroke.two,
    borderRadius: layout.borderRadiusFull,
  },
  chipLabel: {
    ...typography.badge,
    lineHeight: typography.label.lineHeight,
  },
  trailingFade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    end: 0,
    width: spacing.lg,
  },
});
