/**
 * Delegate host interface.
 *
 * RouteEngineClient implements this interface and passes `this` to each
 * delegate module function. Delegates remain stateless — they borrow the
 * engine reference, timing wrapper, and notification emitters from the host.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EngineHandle = any;

export interface DelegateHost {
  /** Cached UniFFI VeloqEngine handle. Null before initWithPath(). */
  readonly engine: EngineHandle;
  /** True once the engine has been created. Delegates must guard on this. */
  readonly ready: boolean;
  /** Wraps an FFI call with DEV-mode timing logs and optional metric recording. */
  timed<T>(name: string, fn: () => T): T;
  /** Emit a change notification to subscribers of a single event channel. */
  notify(event: string): void;
  /** Emit change notifications across multiple event channels at once. */
  notifyAll(...events: string[]): void;
}
