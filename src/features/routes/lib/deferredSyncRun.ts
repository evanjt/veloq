/**
 * A GPS sync run asked for while another holds the mutex, kept until it can
 * have its turn.
 *
 * `useRouteDataSync` starts a run from an effect keyed on the activities
 * array, and nothing brings that identity back: a run refused because one is
 * already in flight is simply dropped, and the only things that ask again are
 * a reconnect and an engine reset. Before the engine announced its activity
 * steps that never happened, because the array changed once per sync, at the
 * settle. It changes twice now, so the second change lands while the head's
 * tracks are still downloading and the remainder's would never be fetched in
 * that session.
 *
 * Module state rather than a ref, because the mutex it shadows is module
 * state too (`useRouteSyncContext`): the instance that is refused and the
 * instance that finishes need not be the same one.
 */
let owed = false;

/** Record that a run was wanted and refused. */
export function deferSyncRun(): void {
  owed = true;
}

/** Whether a run is owed, clearing the debt. */
export function takeDeferredSyncRun(): boolean {
  const wanted = owed;
  owed = false;
  return wanted;
}

/**
 * Drop the debt. A wipe re-arms the sync itself, so a run deferred against
 * the library that was just deleted is not one anybody is waiting on.
 */
export function clearDeferredSyncRun(): void {
  owed = false;
}
