import { StyleSheet } from 'react-native';

import { ENDPOINT_3D_CASING_RADIUS } from '@/features/maps/light';
import { spacing } from '@/theme';

/** Geometry of the feed's activity card, read by the card and by its skeleton. */
export const CARD_HEIGHT = 240;
export const CARD_MARGIN = spacing.smPlus;
/**
 * The frame a card's route is fitted inside, in pixels from each edge of the map. The end markers
 * stay whole at the foot of the route, and the card crops the map by its margin on the left and
 * the right.
 */
export const CARD_FIT_INSET = {
  top: ENDPOINT_3D_CASING_RADIUS,
  right: ENDPOINT_3D_CASING_RADIUS + CARD_MARGIN,
  bottom: ENDPOINT_3D_CASING_RADIUS,
  left: ENDPOINT_3D_CASING_RADIUS + CARD_MARGIN,
};
/** The zone strip under the card's stats; its top zone stands this tall. */
export const ZONE_STRIP_HEIGHT = spacing.md;
/**
 * How far above the card's foot the map's compass sits, clear of the stats row
 * and the zone strip drawn over the map.
 */
export const CARD_FOOTER_CLEARANCE = 68;

/** The containers the card and its skeleton both stand in: the spacing outside it and the map box. */
export const cardContainers = StyleSheet.create({
  wrapper: {
    marginHorizontal: CARD_MARGIN,
    marginBottom: CARD_MARGIN,
  },
  /** Covers the card inside its margins; carries the card's id where the system menu hides the card. */
  idMarker: {
    position: 'absolute',
    top: 0,
    bottom: CARD_MARGIN,
    left: CARD_MARGIN,
    right: CARD_MARGIN,
  },
  map: {
    position: 'relative',
    height: CARD_HEIGHT,
  },
});
