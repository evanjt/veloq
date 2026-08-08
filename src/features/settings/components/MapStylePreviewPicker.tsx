import React, { memo } from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, mapStylePreview, spacing } from '@/theme';
import { type MapStyleType } from '@/features/maps/components/mapStyles';

const CIRCLE_SIZE = 70;

interface MapStylePreviewPickerProps {
  value: MapStyleType;
  onValueChange: (style: MapStyleType) => void;
}

/** Static thumbnails - three live maps to fill three 70px circles was the
 *  single most expensive thing on the settings screen. */
const MAP_STYLES: { style: MapStyleType; labelKey: string }[] = [
  { style: 'light', labelKey: 'settings.light' },
  { style: 'dark', labelKey: 'settings.dark' },
  { style: 'satellite', labelKey: 'settings.satellite' },
];

function MapStylePreviewPickerComponent({ value, onValueChange }: MapStylePreviewPickerProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  return (
    <View style={styles.container}>
      {MAP_STYLES.map(({ style, labelKey }) => {
        const isSelected = value === style;
        const preview = mapStylePreview[style];

        return (
          <TouchableOpacity
            key={style}
            style={styles.previewItem}
            onPress={() => onValueChange(style)}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.circleContainer,
                isSelected && styles.circleContainerSelected,
                isDark && styles.circleContainerDark,
              ]}
            >
              <View style={[styles.mapCircle, { backgroundColor: preview.land }]}>
                <View style={[styles.previewWater, { backgroundColor: preview.water }]} />
                <View style={[styles.previewRoad, { backgroundColor: preview.road }]} />
                <View style={[styles.previewRoadCross, { backgroundColor: preview.road }]} />
              </View>
            </View>
            <Text
              style={[
                styles.label,
                isSelected && styles.labelSelected,
                isDark && !isSelected && styles.labelDark,
              ]}
            >
              {t(labelKey as never)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export const MapStylePreviewPicker = memo(MapStylePreviewPickerComponent);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  previewItem: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  circleContainer: {
    width: CIRCLE_SIZE + 6,
    height: CIRCLE_SIZE + 6,
    borderRadius: (CIRCLE_SIZE + 6) / 2,
    borderWidth: 3,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.border,
  },
  circleContainerSelected: {
    borderColor: colors.primary,
  },
  circleContainerDark: {
    backgroundColor: darkColors.border,
  },
  mapCircle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    overflow: 'hidden',
  },
  // A river band and two roads. Enough for the eye to read "map" at 70px,
  // without three live renderers running to draw three thumbnails.
  previewWater: {
    position: 'absolute',
    left: -CIRCLE_SIZE * 0.2,
    top: CIRCLE_SIZE * 0.52,
    width: CIRCLE_SIZE * 1.4,
    height: CIRCLE_SIZE * 0.26,
    transform: [{ rotate: '-14deg' }],
  },
  previewRoad: {
    position: 'absolute',
    left: -CIRCLE_SIZE * 0.2,
    top: CIRCLE_SIZE * 0.3,
    width: CIRCLE_SIZE * 1.4,
    height: 3,
    transform: [{ rotate: '18deg' }],
  },
  previewRoadCross: {
    position: 'absolute',
    left: CIRCLE_SIZE * 0.44,
    top: -CIRCLE_SIZE * 0.2,
    width: 3,
    height: CIRCLE_SIZE * 1.4,
    transform: [{ rotate: '10deg' }],
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: 2,
  },
  labelSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
  labelDark: {
    color: darkColors.textSecondary,
  },
});
