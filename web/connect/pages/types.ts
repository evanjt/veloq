// What every page module is given.

import type { Route } from '../router';
import type { Session, Snapshot } from '../session';

export type PageProps = {
  session: Session;
  snapshot: Snapshot;
  route: Route;
};
