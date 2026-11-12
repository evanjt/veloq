// The page's entry. The page itself lives in its own file, loaded from here,
// so a file that fails to load is caught here and the page fetched again.

import { browserEnvironment, clearHealMark, healFailedLoad } from './loader';

const env = browserEnvironment();

import('./main').then(
  () => clearHealMark(env),
  () => void healFailedLoad(env)
);
