import { useTranslation } from 'react-i18next';

import { useSensorStore } from '../store';

/**
 * Translated description of a sensor problem, or null while every paired
 * sensor is healthy. Healthy sensors stay silent; the recording screen
 * only surfaces sensors when one is connecting or dropped.
 */
export function useSensorIssue(): string | null {
  const { t } = useTranslation();
  const connections = useSensorStore((s) => s.connections);

  const entries = Object.values(connections);
  const silent = entries.find((c) => c.status === 'noData');
  const reconnecting = entries.find((c) => c.status === 'reconnecting');
  const connecting = entries.find((c) => c.status === 'connecting');

  // A link that carries nothing outranks a reconnect: the reconnect is only
  // how it is being fixed, and a ride recorded against it has no heart rate.
  if (silent) {
    return `${t('sensors.title', 'Sensors')}: ${t('sensors.status.noData')}`;
  }
  if (reconnecting) {
    return `${t('sensors.title', 'Sensors')}: ${t('sensors.status.reconnecting')}`;
  }
  if (connecting) {
    return `${t('sensors.title', 'Sensors')}: ${t('sensors.status.connecting')}`;
  }
  return null;
}
