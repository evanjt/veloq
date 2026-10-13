import { useTranslation } from 'react-i18next';

import { useSensorStore } from '../store';
import type { SensorAvailability } from '../types';

/** What the ride says for an availability that stops a paired sensor connecting. */
function blockingIssueKey(availability: SensorAvailability) {
  switch (availability) {
    case 'poweredOff':
      return 'sensors.issue.bluetoothOff';
    case 'unauthorised':
    case 'blocked':
      return 'sensors.issue.permission';
    case 'unsupported':
      return 'sensors.issue.unsupported';
    default:
      return null;
  }
}

/**
 * Translated description of a sensor problem, or null while every paired
 * sensor is healthy. Healthy sensors stay silent; the recording screen
 * only surfaces sensors when one is connecting or dropped, or when the radio
 * or the permission keeps a paired one from connecting at all.
 */
export function useSensorIssue(): string | null {
  const { t } = useTranslation();
  const connections = useSensorStore((s) => s.connections);
  const availability = useSensorStore((s) => s.availability);
  const hasPaired = useSensorStore((s) => s.knownSensors.length > 0);

  // Nothing connects while the radio is off or refused, so that is the
  // reason to give, rather than the reconnect it causes.
  const blocking = hasPaired ? blockingIssueKey(availability) : null;
  if (blocking) {
    return t('sensors.issueSummary', { issue: t(blocking) });
  }

  const entries = Object.values(connections);
  const silent = entries.find((c) => c.status === 'noData');
  const reconnecting = entries.find((c) => c.status === 'reconnecting');
  const connecting = entries.find((c) => c.status === 'connecting');

  // A link that carries nothing outranks a reconnect: the reconnect is only
  // how it is being fixed, and a ride recorded against it has no heart rate.
  if (silent) {
    return t('sensors.issueSummary', { issue: t('sensors.status.noData') });
  }
  if (reconnecting) {
    return t('sensors.issueSummary', { issue: t('sensors.status.reconnecting') });
  }
  if (connecting) {
    return t('sensors.issueSummary', { issue: t('sensors.status.connecting') });
  }
  return null;
}
