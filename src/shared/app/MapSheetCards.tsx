/**
 * The cards of a host's sheet, and the one way a row opens a detail subject.
 *
 * A row inside a card opens its subject as another card pushed on top in the same sheet, so the
 * sheet stays presented at its stop and the map follows the card on top. Nothing is presented
 * over the sheet and the sheet is never dismissed to navigate. Outside a host's cards (the feed,
 * a list, a deep link), or for a subject the host has no card for, the subject opens as its own
 * detail screen.
 *
 * Every card stays mounted under the one on show, moved out of view, so popping one shows the
 * card below scrolled and picked as it was left. Every card above the root carries a round close
 * control at its top-right, which pops it; the root carries none, since leaving it is the
 * screen's back. Android's back pops a pushed card first and leaves the screen from the root,
 * which `MapSheetHostSheet` does. The iOS edge swipe and the header's back leave the screen with
 * every card on it.
 */

import React, { memo, useCallback, useEffect, useMemo, type ComponentType } from 'react';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';
import { ResourceSavingView } from 'expo-router/react-navigation';
import { useTranslation } from 'react-i18next';

import {
  MapSheetCardContext,
  useMapSheetCard,
  useMapSheetHost,
  type MapSheetCardValue,
} from './MapSheetHost';
import {
  popHostCard,
  pushHostCard,
  useHostCards,
  type MapSheetCardKind,
  type MapSheetCardParams,
  type MapSheetCardSubject,
} from './mapSheetHost';
import { navigateTo } from './navigation';
import { useTheme } from './useTheme';
import { Icon } from '@/shared/ui/Icon';
import { IconButton } from '@/shared/ui/IconButton';
import { colors, controlHeight, darkColors, iconSize, layout, spacing } from '@/theme';

/** What a card component is handed: its subject's id and what it was opened with. */
export interface MapSheetCardProps {
  id: string;
  params: MapSheetCardParams;
}

/** The card component each kind draws in a sheet. A kind with none opens as its own screen. */
export type MapSheetCardRegistry = Partial<
  Record<MapSheetCardKind, ComponentType<MapSheetCardProps>>
>;

/** Where each kind's detail screen sits, its id following. */
const DETAIL_PATHS: Record<MapSheetCardKind, string> = {
  route: '/route/',
  section: '/section/',
  activity: '/activity/',
  'section-history': '/section/history/',
  'section-laps': '/section/laps/',
};

/** What a screen reader calls a card's close control, by the card's kind. */
const CLOSE_LABELS = {
  route: 'maps.closeRouteCard',
  section: 'maps.closeSectionCard',
  activity: 'maps.closeActivityCard',
  'section-history': 'maps.closeSectionHistoryCard',
  'section-laps': 'maps.closeSectionLapsCard',
} as const satisfies Record<MapSheetCardKind, string>;

/** The detail screen a subject opens as outside a sheet, its defined params as the query. */
export function detailHref(subject: MapSheetCardSubject): string {
  const path = `${DETAIL_PATHS[subject.kind]}${encodeURIComponent(subject.id)}`;
  const query = Object.entries(subject.params ?? {})
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&');
  return query ? `${path}?${query}` : path;
}

/**
 * Opens a detail subject: a card pushed on top of the sheet the caller sits in when the host has
 * a card for it, its own detail screen otherwise.
 */
export function useOpenDetail(): (subject: MapSheetCardSubject) => void {
  const card = useMapSheetCard();
  return useCallback(
    (subject: MapSheetCardSubject) => {
      if (card?.opens(subject.kind)) pushHostCard(card.hostKey, subject);
      else navigateTo(detailHref(subject));
    },
    [card]
  );
}

/**
 * The room a card keeps at the end of its first row for the close control drawn over it, so the
 * control covers none of the name. Nothing on the root card or outside a card stack.
 */
export function MapSheetCardCloseSpace() {
  const card = useMapSheetCard();
  return card && card.index > 0 ? <View style={styles.closeSpace} /> : null;
}

/**
 * The host's cards, the root first. `rootParams` are what the host's route was opened with,
 * which belong to its root card.
 */
export function MapSheetCards({
  registry,
  rootParams,
}: {
  registry: MapSheetCardRegistry;
  rootParams: MapSheetCardParams;
}) {
  const host = useMapSheetHost();
  const hostKey = host?.key ?? '';
  const cards = useHostCards(hostKey);
  const opens = useCallback((kind: MapSheetCardKind) => registry[kind] !== undefined, [registry]);

  // Android's back on a pushed card pops it. From the root the sheet's own handler leaves the
  // screen, and under another screen of the root stack back is that screen's.
  const popsOnBack = Platform.OS === 'android' && !!host?.focused && cards.length > 1;
  useEffect(() => {
    if (!popsOnBack) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      popHostCard(hostKey);
      return true;
    });
    return () => subscription.remove();
  }, [popsOnBack, hostKey]);

  return (
    <View testID="map-sheet-cards" style={styles.fill}>
      {cards.map((card, index) => {
        const Card = registry[card.kind];
        return Card ? (
          <CardSlot
            key={`${index}:${card.kind}:${card.id}`}
            Card={Card}
            kind={card.kind}
            id={card.id}
            params={index === 0 ? rootParams : card.params}
            hostKey={hostKey}
            index={index}
            onTop={index === cards.length - 1}
            opens={opens}
          />
        ) : null;
      })}
    </View>
  );
}

interface CardSlotProps {
  Card: ComponentType<MapSheetCardProps>;
  kind: MapSheetCardKind;
  id: string;
  params: MapSheetCardParams;
  hostKey: string;
  index: number;
  onTop: boolean;
  opens: (kind: MapSheetCardKind) => boolean;
}

/**
 * One card, kept mounted and out of view while another is on top of it, and out of the screen
 * reader's reach then too. A write to a card's state renders neither this nor the card.
 */
const CardSlot = memo(function CardSlot({
  Card,
  kind,
  id,
  params,
  hostKey,
  index,
  onTop,
  opens,
}: CardSlotProps) {
  const value = useMemo<MapSheetCardValue>(
    () => ({ hostKey, index, onTop, opens }),
    [hostKey, index, onTop, opens]
  );
  return (
    <ResourceSavingView visible={onTop} style={StyleSheet.absoluteFill}>
      <View
        testID={`map-sheet-card-${index}`}
        style={styles.fill}
        accessibilityElementsHidden={!onTop}
        importantForAccessibility={onTop ? 'auto' : 'no-hide-descendants'}
      >
        <MapSheetCardContext.Provider value={value}>
          <Card id={id} params={params} />
        </MapSheetCardContext.Provider>
        {index > 0 ? <MapSheetCardClose kind={kind} hostKey={hostKey} /> : null}
      </View>
    </ResourceSavingView>
  );
});

/** The round control at a pushed card's top-right that pops it. */
function MapSheetCardClose({ kind, hostKey }: { kind: MapSheetCardKind; hostKey: string }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  return (
    <IconButton
      testID="map-sheet-card-close"
      compact
      accessibilityLabel={t(CLOSE_LABELS[kind])}
      onPress={() => popHostCard(hostKey)}
      style={[styles.close, { backgroundColor: palette.fillNeutral }]}
    >
      <Icon name="close" size={iconSize.sm} color={palette.iconSecondary} />
    </IconButton>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  closeSpace: {
    width: controlHeight.buttonSm + spacing.sm,
  },
  close: {
    position: 'absolute',
    top: spacing.xs,
    end: spacing.sm,
    borderRadius: layout.borderRadiusFull,
  },
});
