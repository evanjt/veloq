import { useCallback } from 'react';

/**
 * Shape of messages posted from the WebView via `window.ReactNativeWebView.postMessage`.
 * All messages carry a `type` string; other fields are specific to the message type.
 */
export interface WebViewBridgeMessage {
  type: string;
  [key: string]: unknown;
}

export type WebViewBridgeHandlers = Record<
  string,
  (data: WebViewBridgeMessage) => void | Promise<void>
>;

interface WebViewEvent {
  nativeEvent: { data: string };
}

/**
 * Parses `postMessage` payloads from a WebView and dispatches them by `type`.
 *
 * Shared between `Map3DWebView` and `TerrainSnapshotWebView`. Handles JSON parse
 * errors, validates the message shape (object with a string `type`), and ignores
 * unknown types silently so new message kinds can roll out without breaking.
 *
 * The returned function is stable as long as `handlers` is stable. Callers should
 * memoize their handlers map (usually via `useCallback` or refs in the handlers).
 */
export function useWebViewBridge(handlers: WebViewBridgeHandlers) {
  return useCallback(
    (event: WebViewEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (typeof data !== 'object' || data === null || typeof data.type !== 'string') {
          return;
        }
        const handler = handlers[data.type];
        if (handler) {
          // Fire-and-forget async handlers; parent tracks errors via its own refs.
          void handler(data as WebViewBridgeMessage);
        }
      } catch {
        // Ignore parse errors — treat malformed messages as no-ops.
      }
    },
    [handlers]
  );
}
