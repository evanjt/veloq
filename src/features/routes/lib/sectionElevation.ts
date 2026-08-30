/**
 * Which side of a section's elevation profile is worth showing.
 *
 * The engine records gain and loss separately for every enriched section, so a
 * descent carries its vertical in the loss and almost nothing in the gain.
 * Reading gain alone left those sections looking flat.
 */

/** Vertical below this reads as noise on the slice, not as terrain. */
const MIN_ELEVATION_M = 10;

export interface SectionElevation {
  /** Metres of vertical on the chosen side, always positive */
  metres: number;
  /** Which side the figure came from */
  direction: 'gain' | 'loss';
}

interface SectionElevationInput {
  elevationGainM?: number;
  elevationLossM?: number;
  /** climb, descent, rolling, flat or loop, from the engine */
  klass?: string;
}

/**
 * Pick the vertical to display for a section. The engine's class leads when it
 * has one, otherwise the larger side wins. The floor applies to the side that
 * was chosen, so a flat line stays silent instead of reporting its other side.
 */
export function sectionElevation(section: SectionElevationInput): SectionElevation | undefined {
  const gain = side(section.elevationGainM, 'gain');
  const loss = side(section.elevationLossM, 'loss');

  let chosen: SectionElevation | undefined;
  if (section.klass === 'descent') {
    chosen = loss ?? gain;
  } else if (section.klass === 'climb') {
    chosen = gain ?? loss;
  } else if (gain && loss) {
    chosen = loss.metres > gain.metres ? loss : gain;
  } else {
    chosen = gain ?? loss;
  }

  return chosen && chosen.metres >= MIN_ELEVATION_M ? chosen : undefined;
}

function side(
  metres: number | undefined,
  direction: 'gain' | 'loss'
): SectionElevation | undefined {
  if (metres == null || !Number.isFinite(metres) || metres <= 0) return undefined;
  return { metres, direction };
}
