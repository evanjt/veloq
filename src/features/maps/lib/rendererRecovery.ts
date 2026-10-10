/**
 * What a map WebView does when the process rendering its page dies.
 *
 * On Android the view is finished: the platform says a view whose renderer is
 * gone can never be used again and has to leave the hierarchy, so the page
 * comes back in a new view. iOS terminates the web content process and reloads
 * into the same view, so there the page reloads in place.
 *
 * One renderer can carry every map page in the process, so a single death
 * reaches every surface at once. Their restarts are spaced out rather than
 * booting every page together into the memory pressure that likely caused it.
 * A page that kills its renderer as it loads would otherwise restart for ever,
 * so each surface may restart a few times in a window and then stays down.
 */
import { Platform } from 'react-native';

import { recordCrash } from '@/shared/debug/crashLog';

/** Restarts a surface may make inside one window before it stays down. */
export const RENDERER_CRASH_LIMIT = 3;
export const RENDERER_CRASH_WINDOW_MS = 60_000;
/** The gap between two restarts, across every surface in the process. */
export const RENDERER_RESTART_STAGGER_MS = 500;
/**
 * The longest a restart waits for its turn: one gap per map WebView that can
 * be mounted at once, the 2D and 3D surfaces of a screen and the two snapshot
 * workers, with room for a third surface. A turn further out than this is a
 * clock that moved back, not a queue.
 */
const MAX_RESTART_WAIT_MS = RENDERER_RESTART_STAGGER_MS * 5;

export type RendererRestart = 'remount' | 'reload';

export interface RendererRecoveryActions {
  /** The page is gone: stop sending to it and drop what it held. Runs at once. */
  forget: () => void;
  /**
   * Bring the page back. A remount is the caller giving the WebView a new key;
   * a reload is calling `reload()` on the view it has. Runs on the surface's
   * turn.
   */
  restart: (how: RendererRestart) => void;
  /** The surface spent its restarts: mount no view and say the map is unavailable. */
  exhausted: () => void;
}

export interface RendererRecovery {
  /** Wired to both `onRenderProcessGone` and `onContentProcessDidTerminate`. */
  gone: () => void;
  /** Cancels a restart still waiting for its turn, for a surface that unmounts. */
  cancel: () => void;
}

/** How a page whose renderer died comes back on this platform. */
export function rendererRestart(): RendererRestart {
  return Platform.OS === 'android' ? 'remount' : 'reload';
}

let nextTurnAt = 0;

/** Runs `run` on the next free turn, at once when none is taken. Returns a cancel. */
function onNextTurn(run: () => void): () => void {
  const now = Date.now();
  const wait = Math.min(Math.max(0, nextTurnAt - now), MAX_RESTART_WAIT_MS);
  nextTurnAt = now + wait + RENDERER_RESTART_STAGGER_MS;
  if (wait === 0) {
    run();
    return () => {};
  }
  const timer = setTimeout(run, wait);
  return () => clearTimeout(timer);
}

/**
 * One surface's recovery. `surface` names it in the crash log. `actions` is
 * read on every death, so a caller may pass an object it keeps current.
 */
export function createRendererRecovery(
  surface: string,
  actions: () => RendererRecoveryActions
): RendererRecovery {
  let deaths: number[] = [];
  let cancelTurn: (() => void) | null = null;

  const cancel = () => {
    cancelTurn?.();
    cancelTurn = null;
  };

  const gone = () => {
    const now = Date.now();
    deaths = deaths.filter((at) => now - at < RENDERER_CRASH_WINDOW_MS);
    const spent = deaths.length >= RENDERER_CRASH_LIMIT;
    const how = rendererRestart();
    recordCrash({
      source: 'webview-renderer',
      fatal: false,
      message: spent
        ? `${surface} renderer gone ${RENDERER_CRASH_LIMIT + 1} times in ${RENDERER_CRASH_WINDOW_MS / 1000} s, left down`
        : `${surface} renderer gone, ${how === 'remount' ? 'remounting' : 'reloading'}`,
    });
    // A restart still waiting belongs to a page that is already gone again.
    cancel();
    actions().forget();
    if (spent) {
      actions().exhausted();
      return;
    }
    deaths.push(now);
    cancelTurn = onNextTurn(() => {
      cancelTurn = null;
      actions().restart(how);
    });
  };

  return { gone, cancel };
}
