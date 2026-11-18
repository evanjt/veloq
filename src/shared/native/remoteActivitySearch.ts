/**
 * The engine's search of the athlete's account, behind the shared engine layer
 * so a feature does not reach the engine itself.
 */

import { sync, type FfiRemoteActivitySearch } from 'veloqrs';

/** The feed's filter as the search takes it. */
export type RemoteActivityQuery = Parameters<typeof sync.searchRemoteActivities>[0];

/** The activities of the signed-in account the library does not hold. */
export const searchRemoteActivities = (
  query: RemoteActivityQuery
): Promise<FfiRemoteActivitySearch> => sync.searchRemoteActivities(query);

/** Download one activity of the account by its server id into the library. */
export const downloadRemoteActivity = (id: string) => sync.syncActivityDetail(id);
