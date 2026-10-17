import type { MaterialCommunityIcons } from '@expo/vector-icons';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Go to the athlete's own location. The crosshair means nothing else on a map. */
export const LOCATE_GLYPH: IconName = 'crosshairs-gps';

/** Frame what the map shows, whether every activity or the one in a popup. */
export const FIT_GLYPH: IconName = 'fit-to-screen-outline';

/** A count of activities of any sport, so it is no sport's figure. */
export const ACTIVITY_COUNT_GLYPH: IconName = 'counter';
