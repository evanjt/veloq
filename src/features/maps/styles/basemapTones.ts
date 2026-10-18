import { mixColour, type VectorMapPalette } from '@/theme';

/**
 * Every colour the light and dark vector basemaps paint, derived from the
 * base's five ground tokens so the data line is the only strong colour on the
 * map. The two bases share the derivation: a shade moves the land toward the
 * label colour, and a lesser road steps the road token back toward the land, so
 * the road hierarchy reads through width, casing and these steps on either base.
 */
export function basemapTones({ land, park, water, road, label }: VectorMapPalette) {
  return {
    land,
    park,
    water,
    road,
    label,
    /** Built-up and bare ground: residential areas, airfields, pitches, schools, sand and ice. */
    landShade: mixColour(land, label, 0.06),
    building: mixColour(land, label, 0.12),
    buildingEdge: mixColour(land, label, 0.2),
    /** A minor street, service track or path. */
    roadMinor: mixColour(road, land, 0.35),
    /** A road in a tunnel. */
    roadTunnel: mixColour(road, land, 0.6),
    /** The casing of a minor street, service track or path. */
    roadCasing: mixColour(land, label, 0.25),
    /** The casing of a link, secondary, trunk, primary or motorway. */
    roadMajorCasing: mixColour(land, label, 0.4),
    rail: mixColour(land, label, 0.4),
    boundary: mixColour(land, label, 0.5),
    /** Town, city and country names: the label colour a step further from the land. */
    labelStrong: mixColour(land, label, 1.4),
    halo: land,
  };
}

export type BasemapTones = ReturnType<typeof basemapTones>;
