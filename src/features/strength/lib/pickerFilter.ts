/**
 * The picker's filters and how a tap on the body changes them. Which region a muscle belongs
 * to comes from the engine's picker read; nothing here knows the anatomy.
 */

export interface PickerFilterState {
  equipment: readonly string[];
  region: string | null;
  muscle: string | null;
  query: string;
}

export const EMPTY_PICKER_FILTER: PickerFilterState = {
  equipment: [],
  region: null,
  muscle: null,
  query: '',
};

export interface PickerMuscle {
  slug: string;
  region: string;
}

/**
 * A tap on a muscle. The first tap in a region selects the region; a second tap inside that
 * region selects the muscle, and tapping the selected muscle again returns to the region.
 * A tap in another region moves the selection there.
 */
export function tapBody(
  state: PickerFilterState,
  slug: string,
  muscles: readonly PickerMuscle[]
): PickerFilterState {
  const region = muscles.find((m) => m.slug === slug)?.region;
  if (region == null) return state;
  if (state.region !== region) return { ...state, region, muscle: null };
  return { ...state, muscle: state.muscle === slug ? null : slug };
}

/** Clears the body selection, leaving equipment and the query. */
export function clearBody(state: PickerFilterState): PickerFilterState {
  return { ...state, region: null, muscle: null };
}

export function toggleEquipment(state: PickerFilterState, slug: string): PickerFilterState {
  const equipment = state.equipment.includes(slug)
    ? state.equipment.filter((e) => e !== slug)
    : [...state.equipment, slug];
  return { ...state, equipment };
}
