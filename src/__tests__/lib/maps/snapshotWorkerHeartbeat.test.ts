/**
 * Scenario: the snapshot pool keeps two hidden WebViews mounted for as long as
 * the feed is focused. Each page drives an animation frame loop so a capture
 * has a frame to capture.
 *
 * Expected behaviour: the loop runs while a request is in flight and not
 * between requests. An idle feed, every preview cached and the queue empty,
 * schedules nothing.
 *
 * The heartbeat script is executed here rather than matched as text, so the
 * test fails on what the page does and not on how it is written.
 */

import {
  buildSnapshotWorkerHtml,
  heartbeatScript,
} from '@/features/maps/lib/htmlBuilders/snapshotWorker';
import { buildRenderSnapshotScript } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

interface Harness {
  window: Record<string, unknown>;
  /** Run every frame currently queued, once. */
  pump: () => void;
  /** How many frames have been requested since the page loaded. */
  requested: () => number;
  posted: string[];
}

function run(script: string): Harness {
  let queue: (() => void)[] = [];
  let requested = 0;
  const posted: string[] = [];
  const win: Record<string, unknown> = {
    requestAnimationFrame: (cb: () => void) => {
      requested += 1;
      queue.push(cb);
      return requested;
    },
    ReactNativeWebView: {
      postMessage: (payload: string) => {
        posted.push(payload);
      },
    },
  };
  // The page addresses its own globals bare and through `window`, the way a
  // browser does, so the sandbox has to be both. `has` answers only for what
  // the page owns: trapping every name would hide `JSON` and `Function` from
  // the script and make a thrown lookup look like a passing test.
  const sandbox: Record<string, unknown> = new Proxy(win, {
    has: (target, key) => key === 'window' || key in target,
    get: (target, key) => (key === 'window' ? sandbox : target[key as string]),
    set: (target, key, value) => {
      target[key as string] = value;
      return true;
    },
  });
  new Function('sandbox', `with (sandbox) { ${script} }`)(sandbox);
  return {
    window: win,
    pump: () => {
      const due = queue;
      queue = [];
      due.forEach((cb) => cb());
    },
    requested: () => requested,
    posted,
  };
}

function request(): SnapshotRequest {
  return {
    activityId: 'a1',
    coordinates: [
      [8.5, 47.4],
      [8.6, 47.5],
    ],
    camera: { bearing: 0, pitch: 45, zoom: 12 },
    mapStyle: 'dark',
    routeColor: '#ff0000',
  } as SnapshotRequest;
}

describe('the snapshot worker heartbeat', () => {
  it('schedules no frame while the queue is empty', () => {
    const page = run(heartbeatScript());
    expect(page.requested()).toBe(0);

    page.pump();
    page.pump();
    expect(page.requested()).toBe(0);
  });

  it('runs while a request is in flight', () => {
    const page = run(heartbeatScript());
    (page.window._heartbeat as { start: () => void }).start();

    expect(page.requested()).toBe(1);
    page.pump();
    expect(page.requested()).toBe(2);
    page.pump();
    expect(page.requested()).toBe(3);
  });

  it('starts once, however many times the request asks', () => {
    const page = run(heartbeatScript());
    const heartbeat = page.window._heartbeat as { start: () => void };
    heartbeat.start();
    heartbeat.start();
    heartbeat.start();

    expect(page.requested()).toBe(1);
  });

  it.each(['snapshot', 'snapshotError'])('stops when the page posts %s', (type) => {
    const page = run(heartbeatScript());
    const bridge = page.window.ReactNativeWebView as { postMessage: (p: string) => void };
    (page.window._heartbeat as { start: () => void }).start();
    page.pump();
    const beforeResult = page.requested();

    bridge.postMessage(JSON.stringify({ type, workerId: 0 }));
    page.pump();

    expect(page.requested()).toBe(beforeResult);
    expect(page.posted).toHaveLength(1);
  });

  it('keeps running through a log line, which is not a result', () => {
    const page = run(heartbeatScript());
    const bridge = page.window.ReactNativeWebView as { postMessage: (p: string) => void };
    (page.window._heartbeat as { start: () => void }).start();

    bridge.postMessage(JSON.stringify({ type: 'log', message: 'still going' }));
    page.pump();
    page.pump();

    expect(page.requested()).toBeGreaterThan(2);
  });

  it('can be restarted for the next request', () => {
    const page = run(heartbeatScript());
    const heartbeat = page.window._heartbeat as { start: () => void; stop: () => void };
    heartbeat.start();
    page.pump();
    heartbeat.stop();
    page.pump();
    const idle = page.requested();

    heartbeat.start();
    expect(page.requested()).toBe(idle + 1);
  });

  it('survives a bridge that is not there yet', () => {
    expect(() => {
      new Function('window', `with (window) { ${heartbeatScript()} }`)({
        requestAnimationFrame: () => 1,
      });
    }).not.toThrow();
  });
});

describe('the worker page and the render script agree', () => {
  it('the page carries the heartbeat and starts none of it at load', () => {
    const html = buildSnapshotWorkerHtml(2);
    expect(html).toContain('window._heartbeat');
    expect(html).not.toContain('requestAnimationFrame(rafHeartbeat)');
  });

  it('a queued request is what starts it', () => {
    expect(buildRenderSnapshotScript(request(), 2, 1)).toContain('window._heartbeat.start()');
  });
});
