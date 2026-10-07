import { Animated, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { colors } from '@/theme';
import { CompassArrow } from '@/shared/ui';
import { getStyleIcon, type MapStyleType } from './mapStyles';
import { useMapControlColumn } from '../lib/mapControlColumnLayout';
import { styles } from './ActivityMapView.styles';

const HIT_SLOP = { top: 8, right: 8, bottom: 8, left: 8 };

interface ActivityMapControlsProps {
  isDark: boolean;
  mapStyle: MapStyleType;
  onToggleStyle: () => void;
  hasGradientData: boolean;
  gradientActive: boolean;
  onToggleGradient: () => void;
  is3DMode: boolean;
  hasRoute: boolean;
  onToggle3D: () => void;
  bearingAnim: Animated.Value;
  onResetOrientation: () => void;
  locationLoading: boolean;
  onGetLocation: () => void;
  enableFullscreen: boolean;
  onOpenFullscreen: () => void;
  /** Height of the map the column sits in; bounds it so no button leaves the map. */
  mapHeight: number;
}

export function ActivityMapControls({
  isDark,
  mapStyle,
  onToggleStyle,
  hasGradientData,
  gradientActive,
  onToggleGradient,
  is3DMode,
  hasRoute,
  onToggle3D,
  bearingAnim,
  onResetOrientation,
  locationLoading,
  onGetLocation,
  enableFullscreen,
  onOpenFullscreen,
  mapHeight,
}: ActivityMapControlsProps) {
  const { t } = useTranslation();
  const { top, maxHeight } = useMapControlColumn(mapHeight);

  return (
    <View testID="activity-map-controls" style={[styles.controlsContainer, { top, maxHeight }]}>
      {/* Style toggle */}
      <TouchableOpacity
        testID="activity-map-style-toggle"
        accessibilityRole="button"
        accessibilityLabel={t('maps.toggleStyle')}
        style={[styles.controlButton, isDark && styles.controlButtonDark]}
        onPressIn={onToggleStyle}
        activeOpacity={0.6}
        hitSlop={HIT_SLOP}
      >
        <MaterialCommunityIcons
          name={getStyleIcon(mapStyle)}
          size={22}
          color={isDark ? colors.textOnDark : colors.textSecondary}
        />
      </TouchableOpacity>

      {/* Gradient coloring toggle - only shown when gradient data is available */}
      {hasGradientData && (
        <TouchableOpacity
          testID="activity-map-gradient-toggle"
          accessibilityRole="button"
          accessibilityState={{ selected: gradientActive }}
          accessibilityLabel={t('maps.colorByGradient')}
          style={[
            styles.controlButton,
            isDark && styles.controlButtonDark,
            gradientActive && styles.controlButtonActive,
          ]}
          onPressIn={onToggleGradient}
          activeOpacity={0.6}
          hitSlop={HIT_SLOP}
        >
          <MaterialCommunityIcons
            name="slope-uphill"
            size={22}
            color={
              gradientActive ? colors.textOnDark : isDark ? colors.textOnDark : colors.textSecondary
            }
          />
        </TouchableOpacity>
      )}

      {/* 3D toggle */}
      {hasRoute && (
        <TouchableOpacity
          testID="activity-map-3d-toggle"
          accessibilityRole="button"
          accessibilityLabel={is3DMode ? t('maps.disable3D') : t('maps.enable3D')}
          style={[
            styles.controlButton,
            isDark && styles.controlButtonDark,
            is3DMode && styles.controlButtonActive,
          ]}
          onPressIn={onToggle3D}
          activeOpacity={0.6}
          hitSlop={HIT_SLOP}
        >
          <MaterialCommunityIcons
            name="terrain"
            size={22}
            color={is3DMode ? colors.textOnDark : isDark ? colors.textOnDark : colors.textSecondary}
          />
        </TouchableOpacity>
      )}

      {/* Compass */}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('maps.resetOrientation')}
        style={[styles.controlButton, isDark && styles.controlButtonDark]}
        onPressIn={onResetOrientation}
        activeOpacity={0.6}
        hitSlop={HIT_SLOP}
      >
        <CompassArrow
          size={22}
          rotation={bearingAnim}
          northColor={colors.error}
          southColor={isDark ? colors.textOnDark : colors.textSecondary}
        />
      </TouchableOpacity>

      {/* GPS location */}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('maps.goToLocation')}
        accessibilityState={{ disabled: locationLoading, busy: locationLoading }}
        style={[styles.controlButton, isDark && styles.controlButtonDark]}
        onPress={locationLoading ? undefined : onGetLocation}
        activeOpacity={locationLoading ? 1 : 0.6}
        disabled={locationLoading}
        hitSlop={HIT_SLOP}
      >
        {locationLoading ? (
          <ActivityIndicator
            size="small"
            color={isDark ? colors.textOnDark : colors.textSecondary}
          />
        ) : (
          <MaterialCommunityIcons
            name="crosshairs-gps"
            size={22}
            color={isDark ? colors.textOnDark : colors.textSecondary}
          />
        )}
      </TouchableOpacity>

      {/* Fullscreen expand */}
      {enableFullscreen && (
        <TouchableOpacity
          testID="activity-map-fullscreen"
          accessibilityRole="button"
          accessibilityLabel={t('maps.openFullscreen')}
          style={[styles.controlButton, isDark && styles.controlButtonDark]}
          onPressIn={onOpenFullscreen}
          activeOpacity={0.6}
          hitSlop={HIT_SLOP}
        >
          <MaterialCommunityIcons
            name="fullscreen"
            size={22}
            color={isDark ? colors.textOnDark : colors.textSecondary}
          />
        </TouchableOpacity>
      )}
    </View>
  );
}
