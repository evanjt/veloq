import React, { useCallback, useMemo, useRef } from 'react';
import { Platform, View } from 'react-native';
import * as haptics from '@/shared/ui/haptics';
import { useTranslation } from 'react-i18next';
import { useMapPreferences } from '@/features/settings';
import { shareText } from '@/features/settings/light';
import { type MapStyleType, resolveTerrain3D } from '@/features/maps';
import { useMapPreviewCoordinates } from '../hooks/useMapPreviewCoordinates';
import type { Activity } from '@/types';
import {
  ContextMenu,
  contextMenuHoldIsNative,
  type ContextMenuAction,
  type ContextMenuEntry,
} from '@/shared/ui/ContextMenu';
import { tapTo } from '@/shared/app/navigation';
import { INTERVALS_URLS } from '@/shared/app/constants';
import { debug } from '@/shared/debug/debug';

const log = debug.create('ActivityShare');

interface ActivityCardContextMenuProps {
  visible: boolean;
  onDismiss: () => void;
  activity: Activity;
  /** Whether the card draws a map; only then does the menu offer its style, 3D and reset. */
  hasMap: boolean;
  /** The card the menu belongs to. */
  children: React.ReactElement;
}

const MAP_STYLES: {
  key: MapStyleType;
  icon: ContextMenuAction['icon'];
  systemIcon: ContextMenuAction['systemIcon'];
  labelKey: 'settings.light' | 'settings.dark' | 'settings.satellite';
}[] = [
  { key: 'light', icon: 'white-balance-sunny', systemIcon: 'sun.max', labelKey: 'settings.light' },
  { key: 'dark', icon: 'weather-night', systemIcon: 'moon', labelKey: 'settings.dark' },
  {
    key: 'satellite',
    icon: 'satellite-variant',
    systemIcon: 'globe.americas',
    labelKey: 'settings.satellite',
  },
];

// The 3D item shows the verdict the card's preview renders, from the query that
// preview shares. Where the popup is drawn only while open, the track is read
// only then; the system menu is declared before the hold, so it reads it always.
function useTerrain3DShown(
  activity: Activity,
  enabled: boolean,
  mode: Parameters<typeof resolveTerrain3D>[0]['mode'],
  override: Parameters<typeof resolveTerrain3D>[0]['override']
): boolean {
  const { coordinates, altitude } = useMapPreviewCoordinates(
    activity.id,
    enabled && !!activity.stream_types?.includes('latlng')
  );
  return useMemo(
    () =>
      resolveTerrain3D({
        mode,
        coordinates: coordinates.map((c) => [c.longitude, c.latitude] as [number, number]),
        altitude,
        gain: activity.total_elevation_gain,
        distance: activity.distance,
        override,
      }).show3D,
    [mode, coordinates, altitude, activity.total_elevation_gain, activity.distance, override]
  );
}

export function ActivityCardContextMenu({
  visible,
  onDismiss,
  activity,
  hasMap,
  children,
}: ActivityCardContextMenuProps) {
  const { t } = useTranslation();
  const {
    getStyleForActivity,
    getTerrain3DMode,
    setActivityOverride,
    clearActivityOverride,
    hasActivityOverride,
    getActivityCamera,
  } = useMapPreferences();

  const currentStyle = getStyleForActivity(activity.type, activity.id);
  const hasOverride = hasActivityOverride(activity.id);
  const is3DOn = useTerrain3DShown(
    activity,
    hasMap && (visible || contextMenuHoldIsNative()),
    getTerrain3DMode(activity.type, activity.id),
    getActivityCamera(activity.id) ?? null
  );

  const handleStyleSelect = useCallback(
    (style: MapStyleType) => {
      haptics.selection();
      setActivityOverride(activity.id, { style });
    },
    [activity.id, setActivityOverride]
  );

  const handleToggle3D = useCallback(() => {
    haptics.selection();
    setActivityOverride(activity.id, { terrain3D: !is3DOn });
  }, [activity.id, is3DOn, setActivityOverride]);

  const handleReset = useCallback(() => {
    haptics.light();
    clearActivityOverride(activity.id);
  }, [activity.id, clearActivityOverride]);

  const webId = activity.intervalsWebId;
  // The menu row is gone by the time the sheet presents, so on iPad it points at the card.
  const cardAnchor = useRef<View>(null);
  const handleShare = useCallback(async () => {
    if (!webId) return;
    const url = INTERVALS_URLS.activityPage(webId);
    try {
      await shareText(
        {
          message: Platform.OS === 'ios' ? activity.name : `${activity.name}\n${url}`,
          url: Platform.OS === 'ios' ? url : undefined,
          title: activity.name,
        },
        { subject: activity.name, anchor: cardAnchor }
      );
    } catch (error) {
      log.warn('the share sheet did not open:', error);
    }
  }, [webId, activity.name]);

  const href = `/activity/${activity.id}` as const;

  const entries = useMemo((): ContextMenuEntry[] => {
    const details: ContextMenuEntry = {
      key: 'details',
      label: t('activity.viewDetails'),
      icon: 'information-outline',
      systemIcon: 'info.circle',
      onPress: () => tapTo(href),
    };
    // Share links to intervals.icu, so it needs a page there.
    const share: ContextMenuEntry[] = webId
      ? [
          {
            key: 'share',
            label: t('activity.share'),
            icon: 'share-variant',
            systemIcon: 'square.and.arrow.up',
            onPress: () => void handleShare(),
          },
        ]
      : [];
    const always = [details, ...share];
    if (!hasMap) return always;
    const mapEntries: ContextMenuEntry[] = [
      {
        key: 'mapStyle',
        label: t('activity.mapStyle'),
        icon: 'layers-outline',
        systemIcon: 'map',
        items: MAP_STYLES.map(({ key, icon, systemIcon, labelKey }) => ({
          key,
          label: t(labelKey),
          icon,
          systemIcon,
          checked: currentStyle === key,
          onPress: () => handleStyleSelect(key),
        })),
      },
      {
        key: 'terrain3D',
        label: t('activity.terrainRow'),
        icon: 'terrain',
        systemIcon: 'mountain.2',
        checked: is3DOn,
        onPress: handleToggle3D,
      },
    ];
    if (!hasOverride) return [...always, ...mapEntries];
    const reset: ContextMenuEntry = {
      key: 'reset',
      label: t('activity.resetToDefault'),
      icon: 'undo',
      systemIcon: 'arrow.uturn.backward',
      onPress: handleReset,
    };
    return [...always, ...mapEntries, reset];
  }, [
    t,
    href,
    webId,
    handleShare,
    hasMap,
    currentStyle,
    handleStyleSelect,
    is3DOn,
    handleToggle3D,
    hasOverride,
    handleReset,
  ]);

  return (
    <ContextMenu
      title={activity.name}
      href={href}
      entries={entries}
      visible={visible}
      onDismiss={onDismiss}
    >
      <View ref={cardAnchor} collapsable={false}>
        {children}
      </View>
    </ContextMenu>
  );
}
