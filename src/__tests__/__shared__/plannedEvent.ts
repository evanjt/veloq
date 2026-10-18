import { FfiPlannedCategory, type FfiPlannedEvent } from 'veloqrs';

/** A planned workout as the engine's calendar read returns it, with nothing to follow. */
export function plannedEvent(
  fields: Partial<FfiPlannedEvent> & Pick<FfiPlannedEvent, 'id' | 'day'>
): FfiPlannedEvent {
  return {
    name: '',
    sport: 'Ride',
    category: FfiPlannedCategory.Workout,
    lines: [],
    bar: [],
    ...fields,
  };
}
