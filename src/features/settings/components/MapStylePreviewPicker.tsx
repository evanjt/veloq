import React, { memo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { mapStylePreview, spacing } from '@/theme';
import { type MapStyleType } from '@/features/maps';
import { CircleOptionRow, type CircleOption } from '@/shared/ui';

const CIRCLE_SIZE = 70;

interface MapStylePreviewPickerProps {
  value: MapStyleType;
  onValueChange: (style: MapStyleType) => void;
}

const MAP_STYLES: { style: MapStyleType; labelKey: string }[] = [
  { style: 'light', labelKey: 'settings.light' },
  { style: 'dark', labelKey: 'settings.dark' },
  { style: 'satellite', labelKey: 'settings.satellite' },
];

// Bern's old town in the loop of the Aare, drawn in each style's own land, water and road tint.
// Static thumbnails: three live maps to fill three circles was the single most expensive thing on
// the settings screen. In a 100 unit square, north up.
const AARE =
  'M -6 66 C 20 68 52 70 70 66 C 92 61 94 34 72 28 C 58 24 44 30 32 26 C 20 22 12 10 8 -6';
const KRAMGASSE = 'M 14 47 C 34 45 56 46 80 45';
const KIRCHENFELD_BRIDGE = 'M 50 47 L 54 106';
const NORTH_BANK = 'M -6 16 C 30 14 60 12 106 18';

function BernPreview({ style, size }: { style: MapStyleType; size: number }) {
  const preview = mapStylePreview[style];
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Rect x={0} y={0} width={100} height={100} fill={preview.land} />
      <Path d={NORTH_BANK} stroke={preview.road} strokeWidth={3} fill="none" />
      <Path d={KIRCHENFELD_BRIDGE} stroke={preview.road} strokeWidth={3} fill="none" />
      <Path d={AARE} stroke={preview.water} strokeWidth={11} fill="none" strokeLinecap="round" />
      <Path d={KRAMGASSE} stroke={preview.road} strokeWidth={3.5} fill="none" />
    </Svg>
  );
}

function MapStylePreviewPickerComponent({ value, onValueChange }: MapStylePreviewPickerProps) {
  const { t } = useTranslation();

  const options: CircleOption<MapStyleType>[] = MAP_STYLES.map(({ style, labelKey }) => ({
    value: style,
    testID: `map-style-${style}`,
    label: t(labelKey as never),
    render: (size) => <BernPreview style={style} size={size} />,
  }));

  // The padding sits outside the row, which shares out only the width it is given.
  return (
    <View style={styles.container}>
      <CircleOptionRow
        options={options}
        value={value}
        onValueChange={onValueChange}
        maxSize={CIRCLE_SIZE}
        testID="map-style-picker"
      />
    </View>
  );
}

export const MapStylePreviewPicker = memo(MapStylePreviewPickerComponent);

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
});
