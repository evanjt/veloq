import { Alert } from 'react-native';
import type { TFunction } from 'i18next';
import type { FfiDepartedRide } from 'veloqrs';
import { formatShortDate } from '@/shared/format';

/**
 * One line per ride a section edit took out of the section, named by the
 * engine from the library. An edit that took none out has no lines.
 */
export function departedRideLines(rides: readonly FfiDepartedRide[], t: TFunction): string[] {
  return rides.map((ride) =>
    t('sections.rideLeft', {
      name: ride.name,
      date: formatShortDate(new Date(ride.date * 1000)),
    })
  );
}

/** Tell the athlete which rides an edit took out of the section, when it took any. */
export function announceDepartedRides(rides: readonly FfiDepartedRide[], t: TFunction): void {
  const lines = departedRideLines(rides, t);
  if (lines.length === 0) return;
  Alert.alert(t('sections.ridesLeftTitle'), lines.join('\n'));
}
