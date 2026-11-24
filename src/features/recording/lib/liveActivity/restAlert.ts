import { debug } from '@/shared/debug/debug';

const log = debug.create('RestAlert');

/** The one identifier every rest alert shares, so scheduling again replaces the earlier one. */
const REST_ALERT_ID = 'strength-rest-end';

export interface RestAlertPort {
  schedule(id: string, fireAt: number, title: string): Promise<void>;
  cancel(id: string): Promise<void>;
}

interface RestAlert {
  /**
   * Make the scheduled alert match the rest in progress: `restEndsAt` is when it
   * ends, or null when there is no timed rest. A suspended app cannot vibrate at a
   * time of its choosing, so the end of rest is a local notification the system
   * delivers.
   */
  sync(restEndsAt: number | null, now: number, title: string): Promise<void>;
  clear(): Promise<void>;
}

/** Keeps at most one alert pending, and touches the port only when the rest end changes. */
export function createRestAlert(port: RestAlertPort): RestAlert {
  let pendingFor: number | null = null;

  async function cancelPending(): Promise<void> {
    if (pendingFor === null) return;
    pendingFor = null;
    try {
      await port.cancel(REST_ALERT_ID);
    } catch (e) {
      log.warn('could not cancel the rest alert', e);
    }
  }

  return {
    async sync(restEndsAt, now, title) {
      if (restEndsAt === null || restEndsAt <= now) {
        await cancelPending();
        return;
      }
      if (pendingFor === restEndsAt) return;
      pendingFor = restEndsAt;
      try {
        await port.schedule(REST_ALERT_ID, restEndsAt, title);
      } catch (e) {
        pendingFor = null;
        log.warn('could not schedule the rest alert', e);
      }
    },
    clear: cancelPending,
  };
}
