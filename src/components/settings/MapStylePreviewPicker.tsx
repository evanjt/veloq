import React, { memo } from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { MapView, Camera } from '@maplibre/maplibre-react-native';
import { useTheme } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing } from '@/theme';
import { type MapStyleType, getMapStyle } from '@/components/maps/mapStyles';

// Bern, Switzerland coordinates - centered on the Aare river bend around the old town
const BERN_CENTER: [number, number] = [7.457, 46.947];
const PREVIEW_ZOOM = 12.5;
const CIRCLE_SIZE = 95;

interface MapStylePreviewPickerProps {
  value: MapStyleType;
  onValueChange: (style: MapStyleType) => void;
}

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
        const mapStyleValue = getMapStyle(style, {
          lat: BERN_CENTER[1],
          lng: BERN_CENTER[0],
          zoom: PREVIEW_ZOOM,
        });

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
              <View style={styles.mapCircle}>
                <MapView
                  style={styles.mapView}
                  mapStyle={mapStyleValue}
                  logoEnabled={false}
                  attributionEnabled={false}
                  compassEnabled={false}
                  scrollEnabled={false}
                  pitchEnabled={false}
                  rotateEnabled={false}
                  zoomEnabled={false}
                >
                  <Camera
                    defaultSettings={{
                      centerCoordinate: BERN_CENTER,
                      zoomLevel: PREVIEW_ZOOM,
                    }}
                  />
                </MapView>
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
  mapView: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
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
