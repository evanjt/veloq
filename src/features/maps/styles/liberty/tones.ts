import { mapPalette } from '@/theme';
import { basemapTones } from '../basemapTones';

/** The light base's ground, road and label tones, which every Liberty layer paints with. */
export const tones = basemapTones(mapPalette('light'));
