/**
 * A map detail screen while its screen read is pending: the map's ground and the sheet at Peek.
 *
 * The ground is the picture the feed card already drew for the subject when there is one, shown
 * at once, else the map's bare land in the theme. It never pulses, since a map is what lands
 * there. Over it the sheet stands at its lowest stop, or the side panel at regular width, holding
 * blocks for the name, the date line and three numbers, laid out on the same Peek rows as the
 * card that replaces it. A screen reader meets one busy element named for the screen, and nothing
 * here takes a touch, so the header's back chip and the edge swipe work while it shows.
 */

import React, { useEffect } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useSheetWindow } from '@/shared/app/TopSafeAreaContext';
import { useTheme } from '@/shared/app/useTheme';
import { MAP_SHEET_PEEK_STOP, mapSheetCoveredHeight } from '@/shared/app/mapSheetStop';
import { mapSheetPanelWidth } from '@/shared/app/screenHeaders';
import { colors, colourTokens, darkColors, layout, stroke } from '@/theme';

import {
  HeroDateLineSkeleton,
  HeroNameRowSkeleton,
  HeroStatsRowSkeleton,
  heroPeekStyles,
} from './DetailHero';
import { MapSheetHandleBar } from './MapSheetHandle';
import { SkeletonGroup } from './Shimmer';
import { useHeroHeaderBottom } from './useHeroHeaderBottom';

export type MapDetailKind = 'activity' | 'route' | 'section';

/** The numbers a Peek shows: distance, time and climbing, or their route and section kin. */
const PEEK_STAT_COUNT = 3;

const LOADING_KEYS = {
  activity: 'maps.detailLoading.activity',
  route: 'maps.detailLoading.route',
  section: 'maps.detailLoading.section',
} as const;

function PeekBlocks({ animated }: { animated: boolean }) {
  return (
    <View testID="map-detail-skeleton-peek" style={heroPeekStyles.peek}>
      <HeroNameRowSkeleton testID="map-detail-skeleton-name" animated={animated} />
      <HeroDateLineSkeleton testID="map-detail-skeleton-date" animated={animated} />
      <HeroStatsRowSkeleton
        count={PEEK_STAT_COUNT}
        testIDPrefix="map-detail-skeleton-stat-"
        animated={animated}
      />
    </View>
  );
}

/**
 * The Peek blocks alone behind one busy element, for a card inside a sheet already presented
 * over a live map.
 */
export function MapDetailPeekSkeleton({
  kind,
  animated = true,
}: {
  kind: MapDetailKind;
  animated?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <SkeletonGroup testID="map-detail-peek-skeleton" label={t(LOADING_KEYS[kind])}>
      <PeekBlocks animated={animated} />
    </SkeletonGroup>
  );
}

export interface MapDetailSkeletonProps {
  kind: MapDetailKind;
  /** The picture the feed card drew for the subject, when one is cached. */
  previewUri?: string | null;
  /** Called once the picture has loaded or failed, or at once when there is none. */
  onPreviewSettled?: (() => void) | undefined;
  animated?: boolean | undefined;
}

export function MapDetailSkeleton({
  kind,
  previewUri,
  onPreviewSettled,
  animated = true,
}: MapDetailSkeletonProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const sheetWindow = useSheetWindow();
  const headerBottom = useHeroHeaderBottom();
  const palette = isDark ? darkColors : colors;
  const land = colourTokens[isDark ? 'dark' : 'light']['map-land'];

  useEffect(() => {
    if (!previewUri) onPreviewSettled?.();
  }, [previewUri, onPreviewSettled]);

  const panelWidth = mapSheetPanelWidth(sheetWindow);
  const peekHeight = mapSheetCoveredHeight(
    Platform.OS,
    Platform.Version,
    sheetWindow,
    MAP_SHEET_PEEK_STOP
  );

  return (
    <View testID="map-detail-skeleton" pointerEvents="none" style={styles.fill}>
      <SkeletonGroup label={t(LOADING_KEYS[kind])} style={styles.fill} contentStyle={styles.fill}>
        <View testID="map-detail-skeleton-ground" style={[styles.fill, { backgroundColor: land }]}>
          {previewUri ? (
            <Image
              accessibilityIgnoresInvertColors
              testID="map-detail-skeleton-preview"
              source={{ uri: previewUri }}
              fadeDuration={0}
              onLoad={onPreviewSettled}
              onError={onPreviewSettled}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
            />
          ) : null}
        </View>
        {panelWidth !== null ? (
          <View
            style={[
              styles.panel,
              {
                width: panelWidth,
                paddingTop: headerBottom,
                backgroundColor: palette.surface,
                borderColor: palette.border,
              },
            ]}
          >
            <PeekBlocks animated={animated} />
          </View>
        ) : (
          <View style={[styles.sheet, { height: peekHeight, backgroundColor: palette.surface }]}>
            {Platform.OS === 'android' ? <MapSheetHandleBar /> : null}
            <PeekBlocks animated={animated} />
          </View>
        )}
      </SkeletonGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: layout.borderRadiusXxl,
    borderTopRightRadius: layout.borderRadiusXxl,
    overflow: 'hidden',
  },
  panel: {
    position: 'absolute',
    start: 0,
    top: 0,
    bottom: 0,
    borderEndWidth: stroke.hairline,
  },
});
