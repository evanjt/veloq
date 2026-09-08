/**
 * A fresh worktree cannot populate the tracematch submodule, because its
 * pointer is unpushed, so most sessions run the suite with the directory
 * absent. A test that reads into it there fails on an `ENOENT` that reads as a
 * broken repository, and a worktree has no hooks, so the suite it discredits is
 * one the session was told to run by hand.
 *
 * Ask this instead and skip with the reason named. In the main checkout the
 * submodule is real and every such test still runs and still asserts.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const TRACEMATCH_ROOT = resolve('modules/veloqrs/rust/tracematch');

export const tracematchCheckedOut = existsSync(resolve(TRACEMATCH_ROOT, 'Cargo.toml'));

/** `describe` in a checkout that has the submodule, `describe.skip` without it. */
export const describeWithTracematch = tracematchCheckedOut ? describe : describe.skip;
